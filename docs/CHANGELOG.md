# Changelog

## How to add an entry

1. Add a new section under **Unreleased** (or promote Unreleased into a dated step when the step commits land).
2. Newest entries stay at the top.
3. Use the template below. Fill every field. If something cannot be verified from git or the repo, write `unverified` — do not guess.
4. Never put passwords, full connection strings, or real hospital names in this file.
5. Commit the changelog update with the step (or in the docs commit that closes the step).

### Entry template

```markdown
## YYYY-MM-DD — Phase X Step Y — <short title>

- **Commit hash(es):** <hashes or unverified>
- **Added:** …
- **Changed:** …
- **Removed:** …
- **Fixed:** …
- **Database (migrations, roles, RLS):** …
- **New .env keys (names only):** …
- **Tests:** <count and coverage, or unverified>
- **Decisions:** …
- **Follow-ups and open items:** …
```

---

## Unreleased

## 2026-11-04 — Phase 1 Step 3b-1 — Patients, field settings, UHID engine

- **Commit hash(es):** unverified (local commits pending push)
- **Added:** Patients + `patient_identifiers` (table only); patient field catalog/settings/custom fields; UHID format configs/blocks/counters; `PatientsModule` services (`PatientsService`, `PatientFieldsService`, `UhidService`); injectable clock; hospigo_security column-privilege test; patients/UHID Jest suite
- **Changed:** `hospigo_security` hospital update narrowed to `UPDATE (id)`; `GLOBAL_TABLES` allowlists `patient_field_catalog`; isolation fixtures cover new tenant tables; architecture docs for UHID/field settings/Aadhaar pending
- **Removed:** nothing
- **Fixed:** nested Prisma creates omit inherited `tenant_id` (composite FK); tenant `set_config` kept inside transactions for pool safety
- **Database (migrations, roles, RLS):** `20261104180000_tighten_hospigo_security_hospital_update`, `20261104180100_patients_and_identifiers`, `20261104180200_patient_field_settings`, `20261104180300_uhid_engine` — new migrations only (3a untouched). Patients/UHID/clinical: no grants to `hospigo_hq`. FY reset without FY block rejected in service + deferred DB trigger.
- **New .env keys (names only):** `PATIENT_SEARCH_MAX_PAGE_SIZE`
- **Tests:** 48 passing on `hospigo_test` (prior 34 + new isolation/UHID/field/security coverage)
- **Decisions:** hospital-wide UHID counter (all branches); no hardcoding of hospital formats/field lists in app code; Aadhaar write/search deferred; consultant column deferred to visits; setStartNumber role check pending Step 6; new-hospital default field settings deferred to Phase 2 onboarding
- **Follow-ups and open items:** auth/controllers/UI (Step 6); Aadhaar storage rules with manager; Indigo-side UHID tools (Phase 2); ledger design still pending for OPD billing

---

## 2026-11-04 — Phase 1 Step 3a — Prisma schema, roles, RLS

- **Commit hash(es):** `4588800`, `a575da7`, `0f03692`, `02fd360`, `fb9bec9`, `4e0cba9`, plus this docs commit
- **Added:** Prisma 7 schema + init RLS migration; `scripts/db/create-roles.mjs`; reference + dev-only tenant seeds; `PrismaModule`/`PrismaService`; RLS/security Jest suite; `.gitattributes` (LF); `docs/architecture.md`, `docs/folder-guide.md`
- **Changed:** API env validation for owner DB URL; health e2e uses app URL against `hospigo_test` only; eslint/gitignore/prettier ignore generated client; `postinstall`/`prebuild`/`pretest` run `prisma generate`
- **Removed:** `docs/.gitkeep` (replaced by real docs)
- **Fixed:** SECURITY DEFINER ACL — `REVOKE`/`GRANT` after `OWNER TO` must run as `hospigo_security` (`SET ROLE`); global `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` for owner/security; `hq_create_first_superadmin` locks the hospital row (`FOR UPDATE`), refuses missing/non-ACTIVE hospitals, and is race-safe for concurrent first-SuperAdmin calls
- **Database (migrations, roles, RLS):** roles `hospigo_owner` (BYPASSRLS, migrate/seed only), `hospigo_app`, `hospigo_hq`, `hospigo_security` (NOLOGIN); DBs `hospigo` + `hospigo_test`; FORCE RLS on tenant tables; login + first-SuperAdmin SECURITY DEFINER helpers; `hospigo_security` UPDATE on `hospitals` + `EXECUTE` on `cuid_like` for first-SuperAdmin
- **New .env keys (names only):** `POSTGRES_SUPERUSER_URL`, `HOSPIGO_OWNER_PASSWORD`, `HOSPIGO_APP_PASSWORD`, `HOSPIGO_HQ_PASSWORD`, `DATABASE_URL_OWNER`, `DATABASE_URL_TEST`, `DATABASE_URL_OWNER_TEST`, `DATABASE_URL_HQ`, seed password keys
- **Tests:** 34 passed (health/storage + full-table tenant isolation, first-SuperAdmin active/inactive/SUSPENDED/race, HQ privilege allowlist, SECURITY DEFINER PUBLIC revoke)
- **Decisions:** Legacy role `hospigo` and DB `hospigo_dev` left untouched; owner never used by running API; do not expose Postgres publicly
- **Follow-ups and open items:** Auth / Step 4+

---

## 2026-11-04 — Phase 1 Step 2 — NestJS API skeleton, health, local-folder StorageService

- **Commit hash(es):** `0a6286b`
- **Added:** NestJS API under `apps/api` (`@hospigo/api`); Swagger at `/docs`; env validation; health module; local-folder `StorageService` (`STORAGE_SERVICE` token + `LocalFolderStorageDriver`); Jest unit + e2e health tests
- **Changed:** Root ESLint TypeScript support; `.env.example` for API/storage; README for storage and API scripts
- **Removed:** MinIO client dependency and MinIO health checker; all `MINIO_*` env keys
- **Fixed:** Queue health check against Redis; Redis URL guidance toward `127.0.0.1`
- **Database (migrations, roles, RLS):** none in this commit
- **New .env keys (names only):** `NODE_ENV`, `API_PORT`, `STORAGE_ROOT_PATH` (and MinIO keys removed)
- **Tests:** 12 tests — local storage driver (put/get/exists/delete, path traversal, absolute paths, tenant prefix, health ok/fail) and health e2e (`/health`, `/health/details`, `/docs`)
- **Decisions:** Object storage is an injectable `StorageService` (local folder now; S3-compatible later). `GET /health` stays liveness-only; `GET /health/details` checks `postgres`, `redis`, `storage`, `websocket`, `queue`
- **Follow-ups and open items:** Auth restriction for `/health/details` (Step 4); Prisma/RLS tenancy (Step 3a)

---

## 2026-10-26 — Phase 1 Step 1 — Monorepo skeleton

- **Commit hash(es):** `2e067a6`
- **Added:** npm workspaces root; placeholder packages `@hospigo/api`, `@hospigo/web`, `@hospigo/shared`; `tsconfig.base.json`; ESLint; Prettier; Husky pre-commit (`npm run lint`); `.env.example`; README; `.cursor/rules/hospigo.mdc`; `docs/.gitkeep`
- **Changed:** n/a (initial skeleton)
- **Removed:** n/a
- **Fixed:** n/a
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `APP_URL`, `API_URL`, `STAGING_URL`, `DATABASE_URL`, `REDIS_URL`, `MINIO_*` (later removed in Step 2), `SMTP_*`, `JWT_SECRET`
- **Tests:** none in this commit
- **Decisions:** Work on `develop`; `main` is default; public domains use `hospigo.indigocomputers.in`; never commit `.env`
- **Follow-ups and open items:** NestJS API skeleton (Step 2)
