# Hospigo architecture notes (Phase 1 / Steps 3a–4)

## Tenancy

- Each hospital row is a tenant. `hospitals.id` is the tenant id.
- Tenant tables carry `tenant_id` and reference parents with composite keys `(tenant_id, id)` so a row cannot point at another hospital's records.
- Session variable `app.tenant_id` scopes app-role queries. Missing/empty value fails closed (zero rows), never an error that leaks data.
- **TenantDb is the only door** that sets `app.tenant_id` (LOCAL to a transaction via `set_config(..., true)`). Feature services must not call `set_config`, `$transaction`, or inject `PrismaService` for tenant work.

## Request context (Step 4)

- `AsyncLocalStorage` holder: `tenantId`, `userId`, `kind` (`HOSPITAL` | `HQ`), `activeBranchId`, `requestId`.
- API: `runWithContext`, `enterWithContext`, `getContext`, `requireContext`.
- AuthGuard (Step 6a-1) verifies Bearer JWTs and calls `enterWithContext` so `TenantDb.withTenant` works from HTTP handlers.
- Parallel async flows keep isolated stores (verified by test).

## TenantDb (Step 4)

- `TenantDb.withTenant(fn)` reads `tenantId` from request context; refuses if missing or `kind === 'HQ'`; opens a transaction; sets `app.tenant_id` LOCAL; passes the tx to `fn`.
- `PrismaService` stays inside the database module (not exported). Seeds may use a raw owner client.
- Safety-net Jest scan of `apps/api/src` (excluding `database/`, specs) fails on raw Prisma / `$transaction` / raw SQL / `set_config` unless allowlisted by exact path with a reason comment.

## AccessService (Step 4)

- `can(permissionCode, branchId, moduleCode?)` and `branchesFor(permissionCode, moduleCode?)`. Default **DENY**.
- Required together: user exists + active; hospital active (`status === ACTIVE` and `isActive`); branch active; a role assignment grants the permission (`HOSPITAL` scope = all active branches of the hospital; `BRANCH` scope = listed assignment branches only); if `moduleCode` is given, that branch module must be `enabled_by_indigo` and not `restricted_by_hospital`.
- Multi-branch staff get **each branch's own** permissions — never the union across branches. `activeBranchId` only **narrows**.
- Snapshot is memoised on the **request context object only** (never process-global), loaded through TenantDb.
- Schema notes: `user_branches` is membership; `role_assignments` + `role_assignment_branches` are authorization. A BRANCH-scoped assignment listing a branch with no `user_branches` row is possible at the FK level, but **AccessService denies it** — BRANCH scope requires an active assignment-branch **and** an active `user_branches` membership for that branch. HOSPITAL scope does not require membership (covers all active branches). Flags honoured: `users.is_active`, `hospitals.is_active` + `status`, `branches.is_active`, `roles.is_active`, `role_assignments.is_active`, `role_assignment_branches.is_active`, `role_permissions.is_active`, `permissions.is_active`, module/`branch_modules.is_active`. No separate “archived” flag — inactive branch = archived for access.

## Test database rebuild (Step 4)

- Jest `globalSetup` rebuilds `hospigo_test` before every suite.
- **Before any DROP SCHEMA:** both app and owner URLs must be local (`localhost` / `127.0.0.1` / `::1`), share host+port+database, name `hospigo_test`; owner and app connections must report `current_database() = hospigo_test`; if `hospitals` exists with any `is_test = false` row, refuse.
- Then: `DROP SCHEMA public CASCADE` → recreate schema → re-apply create-roles schema USAGE/CREATE grants (CONNECT + default privileges survive) → `prisma migrate deploy` as owner → idempotent reference seed.
- Startup check: tenant tables empty after rebuild (setup + sentinel). Grant audit re-checks schema privileges and policies.
- Safety-net: `PrismaService`, `set_config`, and `$transaction` are forbidden in feature code with **no** allowlist; only `$queryRaw` / `$executeRaw` on TenantDb txs may be allowlisted by exact path.

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

## Import batches (Step 3b-2)

- Bookkeeping only in this step: no Excel parsing, no domain handlers, no controllers/UI.
- `import_types` is a **global** catalog (SELECT for app). Types are **data** — not a hardcoded list in app code. No types are seeded here; features that need an import type insert their own catalog rows.
- Tenant tables: `import_batches`, `import_batch_rows`, `import_exceptions`. App: SELECT/INSERT/UPDATE, no DELETE. Separate per-command RLS policies. `hospigo_hq` has no access.
- **State machine (DB trigger):** DRAFT→PREVIEWED→APPROVED→POSTED→UNDONE; DRAFT/PREVIEWED/APPROVED→FAILED. UNDONE and FAILED are terminal. APPROVED needs `approved_by`/`approved_at`; POSTED needs a prior approval; UNDONE needs undo actor/time/reason.
- **Idempotency:** partial unique index on `(tenant, type, coalesce(branch,''), file_sha256)` while status is active (not UNDONE/FAILED).
- **`raw_values` JSONB** on rows is an **immutable audit/undo copy of the source row only** — never read by business matching logic. Matching is by unique business code (`match_key`); no placeholder master records. `row_number` and `raw_values` cannot change after insert (trigger).
- `ImportBatchService`: create / preview / approve / post / undo / fail / recordException / resolveException; every transition writes `audit_logs`.
- **Later (patient import handler):** after posting imported UHIDs, raise the hospital UHID counter past the highest imported UHID via `setStartNumber` so staff registrations never collide with imported numbers.

## Patient platform identity (Step 6c)

- Patient login accounts are **global** (no `tenant_id`, no hospital link yet): `patient_accounts`, `patient_otp_challenges`, `patient_auth_sessions`.
- Dedicated DB role `hospigo_patient` (`DATABASE_URL_PATIENT`) with SELECT/INSERT/UPDATE on those three tables only — same isolation pattern as `hospigo_hq`. App and HQ are REVOKEd.
- **Patient web BFF (Step 6e):** browser → Next `/api/patient-auth/*` → API `/patient/auth/*` via `API_INTERNAL_URL`. Tokens live only in patient httpOnly cookies (`hospigo_patient_*`, refresh path `/api/patient-auth`); never in JSON to the browser. Staff/HQ cookies stay separate.
- Access JWT `tokenType: PATIENT` signed with `JWT_PATIENT_ACCESS_SECRET`. Request context `kind: PATIENT` has `tenantId: null`. `TenantDb.withTenant` refuses PATIENT (and HQ) so no tenant-scoped path can run.
- OTP delivery: `MessageProvider` interface; only `DevMessageProvider` (logs message; refuses `NODE_ENV=production`). Real WhatsApp/SMS later.

## Auth foundation (Step 6a-1)

- **Branch access codes:** `branches.access_code` is NOT NULL, globally unique case-insensitive (`lower(trim(access_code))`). Hospitals no longer store access codes. Main Branch inherited the hospital code in migration; other existing branches got `dev-placeholder-<id>` (dev/test data only).
- **Lookup:** `lookup_branch_by_access_code(code)` (SECURITY DEFINER, fixed `search_path`) returns `(branch_id, tenant_id, is_main)` only when the branch and hospital are active. Unknown / inactive branch / inactive hospital all return the same empty result. Execute granted to `hospigo_app` only.
- **Password flags:** `users` and `hq_users` have `must_change_password` (default **true**), `password_changed_at`, `last_login_at`. Dev seeds set `must_change_password=false` for local demos only.
- **Sessions:** `auth_sessions` (tenant RLS) and `hq_auth_sessions` (global; HQ role only) store **hashed** refresh secrets (`token_hash`), `family_id`, expiry/revocation/rotation fields. Never store raw refresh tokens.
- **Refresh token format:** hospital `h.<tenantId>.<sessionId>.<secret>` (tenant id lets the server set RLS context before looking up the session); HQ `q.<sessionId>.<secret>`.
- **Config:** single file `apps/api/src/modules/auth/auth.config.ts` — password/lockout/rate/token/link lifetimes with env overrides. JWT secrets: `JWT_HOSPITAL_ACCESS_SECRET` and `JWT_HQ_ACCESS_SECRET` (required, ≥32 chars, must differ).
- **Token types:** `HOSPITAL`, `HQ`, `CHANGE_PASSWORD_HOSPITAL`, `CHANGE_PASSWORD_HQ`. Separate signing keys for hospital vs HQ. Hospital access claims include `tenantId`, `userId`, `branchId` (the branch whose code was used). Access JWTs pin **HS256** on sign and verify; refresh secret checks use constant-time `timingSafeEqual` (`PasswordService.verifyRefreshSecret`).
- **AuthGuard + `@Public()` + `@TokenKinds(...)`:** registered **globally** (`APP_GUARD`) in Step 6a-2 — deny by default. Verifies Bearer token, enforces allowed types, sets request context. HQ tokens refused on hospital routes and the reverse. `CHANGE_PASSWORD_*` accepted only where listed. Non-HTTP contexts (Socket.IO) are skipped.
- **HQ DB:** `HqPrismaService` uses `DATABASE_URL_HQ` (`hospigo_hq`). Provided only inside `AuthModule` — other modules must not import it.
- **Login helper:** access code → branch → tenant, then user lookup under `runWithContext`; membership requires active `user_branches` for that branch. All failure modes return the same internal `AUTH_FAILED` result.

## Auth endpoints (Step 6a-2)

- **HTTP:** `POST /auth/hospital/login`, `POST /auth/hq/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/change-password`, `GET /auth/me`. See `docs/api-auth.md`.
- **Public routes:** hospital/hq login, refresh, logout (refresh body), health. Swagger at `/docs` only when `NODE_ENV !== 'production'`.
- **Generic 401:** unknown access code, inactive branch/hospital, unknown email, wrong password, disabled user, missing membership, and account lockout share one status and body. Dummy argon2 verify runs on paths that never check a real hash (timing).
- **Lockout / rate limit:** Redis (`AuthRedisService`, key prefix `hospigo:auth:`). IP limit and per-account lockout (hashed code+email keys); change-password uses a separate `cpw:` sub-prefix keyed by user id. **Fail closed:** if Redis is unreachable, login, refresh, and change-password return 503 — never allowed through. Lockout responses stay generic 401.
- **Refresh:** rotate every use; reuse of a revoked/replaced token revokes the whole family and audits `AUTH_REFRESH_REUSE`. Refresh re-checks user/branch/hospital/membership; failure revokes the family.
- **Forced change:** login with `must_change_password` returns only a `CHANGE_PASSWORD_*` access token (no refresh). Accepted on change-password only; other routes refuse it.
- **Logout design:** `@Public` + `refreshToken` in body (idempotent). Safer than requiring a live access Bearer — an expired access token can still end the session when the refresh secret is presented.
- **Audits (tenant known):** `AUTH_LOGIN_SUCCESS`, `AUTH_PASSWORD_CHANGE`, `AUTH_REFRESH_REUSE`, `AUTH_LOCKOUT` → `audit_logs` (no passwords/tokens/raw emails). HQ events and unknown-tenant failures → Nest Logger only (`audit_logs.tenant_id` is required; HQ has no tenant row).
- **Email flows (Step 6b part A):** activation + password-reset via BullMQ `mail` queue and nodemailer. Job data is `{kind,tenantId,userId}` only; the worker creates hashed action tokens and sends links with the secret after `#`. OTP and patient login remain out of scope.

## Web staff auth (Step 6d)

- Browser → Next.js only. Route handlers call the API with `API_INTERNAL_URL` (server-only; never `NEXT_PUBLIC_*`). Tokens in httpOnly cookies; no JWT verify in the web app (`getSession` calls `GET /auth/me`). Production startup (`instrumentation.ts`) requires `APP_URL` and `API_INTERNAL_URL`.
- Guards in `/admin` and `/app` layouts require HQ vs HOSPITAL; missing/invalid access always → `/api/auth/refresh?next=…` (refresh cookie path is `/api/auth`, so it is only visible on that handler; single-flight rotation). Wrong kind → `/login` (never refresh). `/login` and `/book/**` stay public.
- Config: `apps/web/src/config/session.ts` (cookie names, lifetimes, error copy, body limit); module nav mapping in `apps/web/src/config/modules.ts`.
- **Exit demo (Step 7):** hospital shell titles and sidebar come from `/auth/me` (`hospitalName`, `activeBranchName`, `enabledModules`). Module pages are guarded with `requireModule`. Page **content** (OPD queue, HQ hospitals list) remains sample data until later phases.
- **First-live seed:** `seedDevTenants` refuses unless `NODE_ENV=development`. Production API startup fails if any `hospitals.is_test` row exists (`assertNoTestTenantsInProduction`).

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
