# Hospigo architecture notes (Phase 1 / Steps 3a–3b-1)

## Tenancy

- Each hospital row is a tenant. `hospitals.id` is the tenant id.
- Tenant tables carry `tenant_id` and reference parents with composite keys `(tenant_id, id)` so a row cannot point at another hospital's records.
- Session variable `app.tenant_id` scopes app-role queries. Missing/empty value fails closed (zero rows), never an error that leaks data.
- Runtime services that set `app.tenant_id` must do so inside the same DB transaction as the queries that depend on it (connection pooling otherwise drops the setting).

## Database roles

| Role               | Purpose                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `hospigo_owner`    | Owns schema/tables; runs Prisma migrations/seeds; `BYPASSRLS` (see note below)         |
| `hospigo_app`      | Runtime API role; least privilege; **no** `BYPASSRLS`; RLS enforced                    |
| `hospigo_hq`       | Indigo HQ provisioning of hospitals/branches/module subscriptions and first SuperAdmin |
| `hospigo_security` | `NOLOGIN` helper; owns `SECURITY DEFINER` functions                                    |

`hospigo_owner` has `BYPASSRLS` and is used **only** for migrations and seeds — never by the running API. Under `FORCE ROW LEVEL SECURITY`, table owners are still subject to RLS, so seeds that insert fixture rows (and migrations that touch tenant data) would otherwise fail or need per-row policies for the owner. `BYPASSRLS` keeps migrate/seed tooling workable; runtime traffic must use `hospigo_app` / `hospigo_hq` so RLS stays enforced. `create-roles` also grants `hospigo_security` to `hospigo_owner` with `INHERIT FALSE, SET TRUE`, and grants `hospigo_security` `CREATE` on schema `public`, so migrations can `ALTER FUNCTION … OWNER TO hospigo_security` without inheriting that role at runtime.

Bootstrap: `node scripts/db/create-roles.mjs` (idempotent, superuser via `POSTGRES_SUPERUSER_URL`).

Firewall: do not expose Postgres publicly; bind to private networks / localhost and use OS firewall rules. No assumption that port 5432 is reachable from the internet.

### hospigo_security column grant (Step 3b-1)

`hq_create_first_superadmin` locks the hospital with `SELECT … FOR UPDATE`. That needs `UPDATE` privilege on the row. The role is granted **`UPDATE (id)` only** on `hospitals` — enough for a no-op lock update path, not enough to change name/status/other columns. Verified by a dedicated column-privilege test; first-SuperAdmin still passes.

## RLS rule

No tenant table ships without `ENABLE` + `FORCE ROW LEVEL SECURITY`. Global allowlist (no tenant RLS), exact names only: `modules`, `permissions`, `hq_users`, `_prisma_migrations`, `patient_field_catalog`. Catalog tests fail if any other public table lacks RLS+FORCE.

HQ access under FORCE RLS uses policies `TO hospigo_hq` / `TO hospigo_security` (not BYPASSRLS on those roles). Login lookup and first-SuperAdmin helpers are `SECURITY DEFINER` owned by `hospigo_security` with fixed `search_path`.

**Patients, clinical data, and UHID tables are never granted to `hospigo_hq`.** Indigo-side UHID/start-number tooling is Phase 2.

## Patients (Step 3b-1)

- `patients`: plain id, `tenant_id`, text `uhid` (never a number), `registered_branch_id`, required trimmed `name`, optional demographics/address, `dob_is_estimated` when only age is known (store estimated DOB — never store age as a number), `is_active` archive flag (no hard delete). Unique `(tenant_id, uhid)`. Phone is indexed but **not** unique (families share numbers). No consultant column yet (comes with visits).
- App grants: `SELECT`, `INSERT`, `UPDATE` only (no `DELETE`). RLS WITH `USING` and `WITH CHECK` on `tenant_id`.
- `patient_identifiers`: separate table for Aadhaar and similar (`value_encrypted`, `value_hash`, `last4`). Table + RLS + grants exist; **no service writes or searches it**. Aadhaar storage rules are undecided with the manager.

## Patient field settings

- `patient_field_catalog` is **global** (SELECT for app). System keys live here; `name` is `always_required` and `can_disable = false`.
- Per hospital: `patient_field_settings` (exactly one of catalog key **or** custom field), `patient_custom_fields` / options / typed values (no JSON blobs).
- Enabling a field or making it mandatory is a **data** change, never a code change. Changes apply to **new** registrations only; old patients are never invalidated. Every settings change writes an `audit_logs` row.
- Service validation: name always required; other fields follow hospital enabled/required settings; disabled fields are ignored (or rejected when requested). The database requires only `name`.
- Default field settings for a **new** hospital will be created by onboarding in Phase 2. Until then, registration without a UHID format config refuses with a clear error.

## UHID engine

- Formats are immutable rows: `uhid_format_configs` + `uhid_format_blocks`. A change = a new config row with `effective_from`. Generator uses the latest config with `effective_from <=` server now. Existing UHIDs are never rewritten.
- **App-role immutability** (migration `…_lock_uhid_format_immutability`): `hospigo_app` has **SELECT + INSERT only** on configs/blocks (no UPDATE/DELETE grants; policies are separate SELECT and INSERT, no UPDATE/DELETE policy). Owner retains full access for migrate/seed/fixtures. No all-role refuse trigger — deferred FY/RUNNING_NUMBER validation tests need owner DELETE of a block to fail at COMMIT with the validation error.
- Block types: `FIXED_TEXT`, `BRANCH_CODE`, `FINANCIAL_YEAR`, `CALENDAR_YEAR`, `SEPARATOR`, `RUNNING_NUMBER`. Exactly one `RUNNING_NUMBER`. Padding is a **minimum** width (numbers may grow, never truncate).
- **Hospital-wide counter:** `uhid_counters` PK `(tenant_id, period_year)` — one sequence shared by **all** branches (`period_year = 0` when reset is `NEVER`). A trigger refuses any decrease of `last_number` (raise-only).
- Generator (one service method, one DB transaction): get-or-create counter, `FOR UPDATE`, increment, build UHID from blocks, insert patient. Any insert failure (including UNIQUE collision with an imported UHID) rolls back so the counter does not advance (no gaps). Error is clear; never skip or duplicate silently.
- Financial-year boundary uses the hospital timezone + `fy_start_month` with an injectable clock (tests use a fake clock; production uses server time).
- **FY-block rule:** `reset_rule = FINANCIAL_YEAR` requires at least one `FINANCIAL_YEAR` block — enforced in the service (`assertUhidConfigValid`) **and** by a deferred constraint trigger on `uhid_format_blocks` / config changes.
- `setStartNumber`: raise-only, requires a reason, writes audit. Permission: Indigo or hospital SuperAdmin only, **not** branch Admin (counter is shared). Role enforcement is pending auth (Step 6); the method takes an actor id and documents the check as pending.
- Patient search: exact UHID, phone, or name prefix; server-side pagination capped by `PATIENT_SEARCH_MAX_PAGE_SIZE`; tenant-scoped. No Aadhaar search.

## Auth note (Step 6)

`lookup_hospital_id_by_access_code` returns only the hospital id for active codes (identical empty result for unknown/inactive). Rate limiting and uniform wrong-password responses are implemented in auth (Step 6), not here. Controllers/UI for patients are also Step 6+.

## Ledger design rules (later — OPD billing step)

When billing/ledger arrives:

- Store money as integer paise (never floats).
- Separate non-negative debit and credit columns.
- Ledger rows are never edited or deleted; reverse with new entries.
- Balances are calculated, not stored as mutable totals.

## Prisma

- Version: Prisma ORM **7.10.1**
- CLI datasource URL: `DATABASE_URL_OWNER` in `apps/api/prisma.config.ts`
- Runtime client: `@prisma/adapter-pg` + `DATABASE_URL` (app role)
- Generate: automatic via `postinstall` / `prebuild` / `pretest` (`prisma:generate` in `@hospigo/api`)
- Migrate: `npm run prisma:migrate -w @hospigo/api`
- Seed: `npm run prisma:seed -w @hospigo/api`
- Tests must use `hospigo_test` only (`DATABASE_URL_TEST`)
