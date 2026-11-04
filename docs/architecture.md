# Hospigo architecture notes (Phase 1 / Step 3a)

## Tenancy

- Each hospital row is a tenant. `hospitals.id` is the tenant id.
- Tenant tables carry `tenant_id` and reference parents with composite keys `(tenant_id, id)` so a row cannot point at another hospital's records.
- Session variable `app.tenant_id` scopes app-role queries. Missing/empty value fails closed (zero rows), never an error that leaks data.

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

## RLS rule

No tenant table ships without `ENABLE` + `FORCE ROW LEVEL SECURITY`. Global allowlist (no tenant RLS): `modules`, `permissions`, `hq_users`. Catalog tests fail if any other public table lacks RLS+FORCE.

HQ access under FORCE RLS uses policies `TO hospigo_hq` / `TO hospigo_security` (not BYPASSRLS on those roles). Login lookup and first-SuperAdmin helpers are `SECURITY DEFINER` owned by `hospigo_security` with fixed `search_path`.

## Auth note (Step 6)

`lookup_hospital_id_by_access_code` returns only the hospital id for active codes (identical empty result for unknown/inactive). Rate limiting and uniform wrong-password responses are implemented in auth (Step 6), not here.

## Ledger design rules (later)

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
