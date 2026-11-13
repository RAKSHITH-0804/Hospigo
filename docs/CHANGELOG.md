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

## 2026-11-13 — Phase 1 Step 6c — patient OTP login API

- **Commit hash(es):** (uncommitted)
- **Added:** global `patient_accounts` / `patient_otp_challenges` / `patient_auth_sessions`; role `hospigo_patient`; `PatientPrismaService`; OTP request/verify/refresh/logout + `GET /patient/me`; `MessageProvider` + `DevMessageProvider`; phone normalize; Redis `otp:` limits
- **Changed:** `TokenService` / `RequestKind` / AuthGuard for `PATIENT`; TenantDb refuses PATIENT; create-roles + CI env for patient DB/JWT/OTP secrets
- **Removed:** none
- **Fixed:** atomic OTP attempt/consume via parameterized `$queryRaw`/`$executeRaw` (DB `now()`); request-otp invalidate+insert in one SQL statement; patient logout `@Public` + family revoke (refreshToken only)
- **Database (migrations, roles, RLS):** `20261113100000_patient_accounts_and_otp` — SIU to `hospigo_patient` only; REVOKE from app/hq/PUBLIC; no tenant RLS
- **New .env keys (names only):** `DATABASE_URL_PATIENT`, `HOSPIGO_PATIENT_PASSWORD`, `JWT_PATIENT_ACCESS_SECRET`, `OTP_HASH_SECRET`, `OTP_*`, `PATIENT_*_TOKEN_TTL_SEC`
- **Tests:** phone normalize; OTP HTTP e2e (incl. parallel wrong/correct verify races + public logout); role grants; token separation; Redis fail-closed; existing suite retained
- **Decisions:** direct OTP send (not BullMQ) — code never stored plaintext; queue would require putting code in job data or regenerating. Dev driver only; production refuses DevMessageProvider. Request-otp uses single-statement CTE (not Prisma `$transaction`) because TenantDb safety-net hard-forbids `$transaction` in feature modules.
- **Follow-ups and open items:** hospital patient record linking; real WhatsApp/SMS providers; BOOKING OTP purpose

## 2026-11-12 — Phase 1 Step 7 — hardening and exit demo

- **Commit hash(es):** (uncommitted)
- **Added:** `/auth/me` `branches` + `enabledModules` (hospital); web module mapping + `requireModule`; distinct DEMO_NORTH/SOUTH module sets; first-live seed guard + production `isTest` refuse; `docs/env-reference.md`, `docs/engineering-tracker.md`, `docs/staging-checklist.md`; auth/me shell HTTP tests; web modules/module-guard tests
- **Changed:** hospital shell reads real session (no mock branch label); CI `APP_URL` → throwaway `http://127.0.0.1:3001`; web production instrumentation also requires `API_INTERNAL_URL`
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** none (seed-only module subscription differences)
- **New .env keys (names only):** optional `WEB_ERROR_MODULE_UNAVAILABLE`
- **Tests:** API shell/me + seed guards; web mapping/guard/shell; prior isolation/auth suites retained
- **Decisions:** production demo detection uses `hospitals.isTest` only; module nav labels live in `config/modules.ts` not components
- **Follow-ups and open items:** backups/FTP, WebSocket auth, load tests, release runbook (see engineering-tracker)

## 2026-11-12 — Phase 1 Step 6b fix — Strict Mode hash token capture

- **Commit hash(es):** (uncommitted)
- **Added:** StrictMode page tests for reset/activate; activate page spec
- **Changed:** `takeActionTokenFromHash` idempotent module capture so a cleared `#t=` is not treated as missing
- **Removed:** none
- **Fixed:** first open of a valid email reset/activate link no longer shows invalid-link under React Strict Mode
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** StrictMode + missing/malformed hash + POST body token
- **Decisions:** first hash read wins in memory; never re-decide from an empty fragment on the same path
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6b part B — web activate / forgot / reset

- **Commit hash(es):** (uncommitted)
- **Added:** BFF `forgot-password`, `hq-forgot-password`, `reset-password`, `activate`; pages `/forgot-password`, `/reset-password`, `/activate`; login forgot link + `?notice=password-updated`; Referrer-Policy/Cache-Control headers; web tests + API activate weak-password coverage
- **Changed:** session config copy/paths for email flows; docs for web flow
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** optional `WEB_FORGOT_*` / `WEB_ERROR_INVALID_LINK` / `WEB_ERROR_PASSWORD_VALIDATION` / `WEB_PASSWORD_UPDATED_NOTICE*`
- **Tests:** web handler/page/headers/token-query-scan; API activate weak-password then reuse token
- **Decisions:** token only in `#t=` then memory + POST body; forgot BFF masks non-429 4xx as 202
- **Follow-ups and open items:** none for 6b B

## 2026-11-12 — Phase 1 Step 6b part A — email activation / reset API

- **Commit hash(es):** (uncommitted)
- **Added:** `auth_action_tokens` / `hq_auth_action_tokens`; mail module (nodemailer + BullMQ `mail` queue); `POST /auth/forgot-password`, `/auth/hq/forgot-password`, `/auth/reset-password`, `/auth/activate`; `send-activation` script
- **Changed:** SMTP_USER/PASSWORD optional; APP_URL + SMTP_SECURE in API env validation
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** `20261112150000_auth_action_tokens` — hospigo_app SELECT/INSERT/UPDATE on tenant table; hospigo_hq SELECT/INSERT/UPDATE on HQ table; mutual REVOKE
- **New .env keys (names only):** `APP_URL`, `SMTP_SECURE`; `AUTH_FORGOT_PASSWORD_MIN_RESPONSE_MS`, `AUTH_RESET_MAX_REQUESTS_PER_WINDOW`, `AUTH_RESET_REQUEST_WINDOW_MS`, `AUTH_MAIL_JOB_*`
- **Tests:** email token lifecycle / concurrency / forgot-password 202 uniformity / HQ reset / activation
- **Decisions:** job payload never holds tokens/emails; link secret only after `#`; invalid links share one generic 400
- **Follow-ups and open items:** Step 6b part B web screens for activate/reset

## 2026-11-12 — Phase 1 Step 6d fix-up 4 — redirect host uses APP_URL

- **Commit hash(es):** (uncommitted)
- **Added:** `appUrl()` helper; refresh `Location` built from `APP_URL` origin; refresh single-flight map on `globalThis`
- **Changed:** docs/`.env.example` note that APP_URL must match the browser origin
- **Removed:** none
- **Fixed:** refresh no longer redirects `127.0.0.1` sessions onto `localhost` (cookie host mismatch)
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** refresh Location origin follows APP_URL when request host is localhost; open-redirect still rejected
- **Decisions:** absolute redirects use APP_URL; relative `next/navigation` redirects stay relative
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6d fix-up 3 — change-password BFF errors

- **Commit hash(es):** (uncommitted)
- **Added:** BFF maps upstream 400→`VALIDATION`, 403→`FORBIDDEN`; safe one-line 500 logs; change-password form keeps fields on error
- **Changed:** bad/empty 2xx upstream body → 502 `UNAVAILABLE` (not uncaught 500)
- **Removed:** none
- **Fixed:** hospital change-password password-rule failures no longer surface as opaque web 500
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** optional `WEB_ERROR_CHANGE_PASSWORD_*` copy overrides
- **Tests:** VALIDATION/502/safe-log handler tests; form keeps fields for VALIDATION/INVALID_CREDENTIALS/RATE_LIMITED
- **Decisions:** never forward upstream arrays/stack traces; validation copy stays generic (no hardcoded min length in UI)
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6d fix-up 2 — health gate + forwarded headers

- **Commit hash(es):** (uncommitted)
- **Added:** `WEB_TRUST_FORWARDED_HEADERS` (default false); HQ session gate on `GET /api/health`
- **Changed:** `/api/health` returns only `{ status }`; client IP ignores spoofed XFF unless trust flag is true
- **Removed:** none
- **Fixed:** public `/api/health` no longer unauthenticated
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_TRUST_FORWARDED_HEADERS`
- **Tests:** health 401/403/HQ-minimal fields; trust-forwarded true/false IP tests
- **Decisions:** production proxy needs web trust flag + API `AUTH_TRUSTED_PROXY` hop count together
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6d cleanup — no browser API URL

- **Commit hash(es):** (uncommitted)
- **Added:** BFF `GET /api/health`; `instrumentation.ts` production `APP_URL` gate; X-Forwarded-For forwarding test
- **Changed:** `StorageStatusCard` calls `/api/health` (same-origin); NEXT_PUBLIC scan covers `.env.example` + `jest.env.cjs` and secret-like / API URL names
- **Removed:** `apps/web/src/lib/api.ts`; `NEXT_PUBLIC_API_URL` from web `.env.example` and `jest.env.cjs`
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** web suite (was 41) + XFF + APP_URL startup + tighter NEXT_PUBLIC scan
- **Decisions:** browser must never know API URL; production fails at startup if `APP_URL` unset
- **Follow-ups and open items:** none

## 2026-11-11 — Phase 1 Step 6d — web staff authentication

- **Commit hash(es):** (uncommitted)
- **Added:** Next BFF auth routes (`/api/auth/*`), httpOnly session cookies, `getSession` / layout guards, real `/login` + `/change-password`, shell display name + Sign out; `apps/web/src/config/session.ts`; `API_INTERNAL_URL` in env examples; `create-hq-admin` npm script on `@hospigo/api`
- **Changed:** `/login` is live (no sample badge / Step 6 note); `/admin` and `/app` require session kind; docs for web auth flow and trusted-proxy note
- **Removed:** sample-only login copy
- **Fixed:** protected layouts always bounce missing access through `/api/auth/refresh` (refresh cookie path `/api/auth` is not sent on `/admin`/`/app`); single-flight cleanup timer `unref`’d; middleware overwrites client `x-pathname`
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `API_INTERNAL_URL`; optional `WEB_*` session overrides
- **Tests:** web suite 41 (auth handler/guard/middleware/form/NEXT_PUBLIC scan); refresh-path + x-pathname overwrite covered
- **Decisions:** tokens never reach browser JS; refresh cookie path `/api/auth`; single-flight refresh map; Origin check on auth POSTs
- **Follow-ups and open items:** patient login / OTP; replace mock page data with APIs

## 2026-11-11 — Phase 1 Step 6a-2 — auth endpoints

- **Commit hash(es):** (uncommitted)
- **Added:** `AuthController` / `AuthService` / DTOs; `AuthRedisService` (IP rate limit + account lockout, fail-closed); global `APP_GUARD` AuthGuard; helmet; `docs/api-auth.md`; HTTP endpoint tests (login failures, lockout, rate limit, refresh reuse, forced change, guard, validation, audits)
- **Changed:** `AuthGuard` is global (deny by default); `@Public` on health + login/refresh/logout; ValidationPipe whitelist/forbidNonWhitelisted/transform; body size + trust-proxy from `auth.config.ts`; Swagger mounted only when `NODE_ENV !== 'production'`; dev seed adds one `must_change_password=true` user (`MC001`); architecture / folder-guide / ci docs
- **Removed:** none
- **Fixed:** change-password brute-force lockout (separate Redis `cpw:` keys); seed emails use hyphenated domains so `@IsEmail` accepts them; refresh/session coverage expanded
- **Database (migrations, roles, RLS):** none (reuses `auth_sessions` / `hq_auth_sessions` / `audit_logs`)
- **New .env keys (names only):** `AUTH_CHANGE_PASSWORD_TOKEN_TTL_SEC`, `AUTH_REQUEST_BODY_LIMIT_BYTES`, `AUTH_TRUSTED_PROXY`, `AUTH_IP_RATE_LIMIT_WINDOW_MS` (plus existing optional `AUTH_*` from 6a-1)
- **Tests:** auth endpoint suite + Redis fail-closed unit tests; keep prior suite green (was 135 before this step)
- **Decisions:** logout is `@Public` + refreshToken body (idempotent); Redis down → 503 on login/refresh; HQ events stay in Nest Logger (`audit_logs` requires `tenant_id`); CI Redis service already present from 6a-1 (`REDIS_URL=redis://127.0.0.1:6379`)
- **Follow-ups and open items:** email/OTP/patient login (6b/6c); WebSocket auth (gateway is currently unauthenticated); restrict `/health/details`

## 2026-11-11 — Phase 1 Step 6a-1 — auth foundation (no endpoints)

- **Commit hash(es):** (uncommitted)
- **Added:** auth module (`PasswordService`, `TokenService`, `AuthGuard`, `@Public` / `@TokenKinds`, login + membership helpers); `HqPrismaService` (`DATABASE_URL_HQ`); `BranchAccessLookup`; `auth.config.ts`; one-time `apps/api/scripts/create-hq-admin.ts`; migrations for branch access codes, lookup function, password flags, `auth_sessions` / `hq_auth_sessions`
- **Changed:** access codes live on branches (not hospitals); JWT env keys split into `JWT_HOSPITAL_ACCESS_SECRET` + `JWT_HQ_ACCESS_SECRET`; argon2 moved to API runtime deps; CI writes the two JWT secrets; README / architecture / folder-guide updated
- **Removed:** `hospitals.access_code`, `lookup_hospital_id_by_access_code`, `JWT_SECRET` from `.env.example` / CI / env validation
- **Fixed:** access JWT sign/verify pin HS256 only; refresh verification uses constant-time `timingSafeEqual`; removed unused `@nestjs/jwt` dependency
- **Database (migrations, roles, RLS):** `20261111190000_branch_access_code` (column + case-insensitive unique index; Main Branch backfill; other branches `dev-placeholder-<id>`); `20261111190100_lookup_branch_by_access_code`; `20261111190200_drop_hospital_access_code`; `20261111190300_user_password_flags`; `20261111190400_auth_sessions` (RLS on `auth_sessions`; grants: `hospigo_app` SIUD on `auth_sessions`; `hospigo_hq` SIU on `hq_users` + SIUD on `hq_auth_sessions` — no other HQ widen)
- **New .env keys (names only):** `JWT_HOSPITAL_ACCESS_SECRET`, `JWT_HQ_ACCESS_SECRET`; optional `AUTH_*` overrides listed in `.env.example`
- **Tests:** branch-code uniqueness; lookup active/unknown/inactive; auth_sessions RLS + HQ grant checks; PasswordService (incl. verifyRefreshSecret); TokenService (HS256 pin, reject none/HS384/wrong family); AuthGuard probe controller; membership login helper; auth config validation (plus existing suite kept green)
- **Decisions:** refresh format `h.<tenantId>.<sessionId>.<secret>` / `q.<sessionId>.<secret>` so hospital session lookup can set tenant context without a cross-tenant scan; AuthGuard not global until 6a-2; seed users set `must_change_password=false` for local demos only; TokenService uses `jsonwebtoken` with HS256 pinned; every refresh check must use `verifyRefreshSecret`
- **Follow-ups and open items:** 6a-2 login/refresh/logout endpoints; register AuthGuard globally when endpoints land; email/OTP/patient login later; local `.env` must replace `JWT_SECRET` with the two new JWT keys (not edited by this step)

## 2026-11-11 — Phase 1 Step 5b — four concept screens with fake data

- **Commit hash(es):** (uncommitted)
- **Added:** concept screens on `/login`, `/admin` (Hospitals), `/app/opd` (OPD queue), `/book/[code]`; Coming later stubs for other HQ and hospital nav items; `apps/web/src/mock` fake data; async mock loader + loading/empty/error states; `docs/ui-concepts.md`; fluid theme tokens (type, spacing, controls, containers) plus login/surface/status colour tokens
- **Changed:** HQ and hospital sidebars use Step 5b nav; staff/booking shells take brand colour from mock hospital config; folder guide lists mock and ui-concepts paths; login phone layout (slim brand bar, no scroll goal) and full-height split from layout breakpoint (~700px); booking full-viewport fluid card with two columns from the same breakpoint; sidebar current-page highlight and desktop page-context top bar; HQ hospitals stacked cards under table breakpoint; auto-fit stat grids; branch label Main Branch (sample); primary colour teal for concept screens; booking/page wrappers use min-height only with document scroll and top-aligned sections
- **Removed:** admin page dependency on the live `/health` Storage status card for this concept step; duplicate Sample data badge on the login brand panel; fixed-device Tailwind size classes from concept screens in favour of theme utility classes; patient-visible access code on `/book/[code]`
- **Fixed:** UI revision rounds 2–4 (contrast, Send OTP gating, fluid layout, clipped non-scrolling pages, stretch gaps between booking sections)
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** Jest render tests for login (one sample badge), hospitals (card+table markup, current nav), OPD queue (three status chip variants, current nav, branch label), booking (no access code, Send OTP disabled until filled, load states); theme hardcode scan; scroll-lock scan (min-height only on page wrappers); shell smoke tests updated
- **Decisions:** PDF is image-based so text description follows the Step 5b prompt plus listed corrections; Platform health remains Coming later while System health card on Hospitals uses Storage wording; concept look is sample-only and driven by CSS variables; layout breakpoint literals documented once beside `@theme` tokens because media queries cannot read variables; `overflow-x: clip` on shell/html instead of `hidden` so document scroll is not trapped; no API calls
- **Follow-ups and open items:** Step 6 real auth; replace mock folder with APIs; wire Onboard hospital, Call next patient, Send OTP

## 2026-11-06 — Phase 1 — CI starts the compiled API and checks /health

- **Commit hash(es):** (uncommitted)
- **Added:** CI step that starts `node apps/api/dist/main.js`, waits up to 30 seconds for `GET /health` to return `{"status":"ok"}`, then stops the process
- **Changed:** README and `docs/ci.md` describe that check
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** local start of the compiled API against the developer `.env`, then `/health`, then the process was stopped
- **Decisions:** no new service container; Redis is already provided and is not contacted by the liveness route
- **Follow-ups and open items:** the compiled-API check runs after the API tests and before the web build and web test steps

## 2026-11-06 — Phase 1 Step 5a fix — cn helper and web CI

- **Commit hash(es):** (uncommitted)
- **Added:** direct `clsx` and `tailwind-merge` dependencies for the web `cn` helper
- **Changed:** CI `ci` job builds and tests `@hospigo/web` after the API tests
- **Removed:** direct `cn` npm dependency from `@hospigo/web`
- **Fixed:** `apps/web/src/lib/utils.ts` now merges class names with `clsx` and `tailwind-merge` instead of the `cn` package
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** web smoke tests and API suite re-run locally; `tsc --noEmit` and web build
- **Decisions:** `shadcn` stays in dependencies because `globals.css` imports `shadcn/tailwind.css`
- **Follow-ups and open items:** `shadcn` still depends on its own `cn` package; production audit findings from `shadcn` and existing Nest `multer` were not auto-fixed

## 2026-11-06 — Phase 1 Step 5a — web shell

- **Commit hash(es):** (uncommitted)
- **Added:** Next.js App Router shell in `apps/web` (login, Indigo HQ, hospital staff, public booking); shared loading, empty, and error states; API client; auth-guard stub; mock navigation; web smoke tests; optional API `CORS_ORIGIN`; root `.nvmrc` and `engines`
- **Changed:** `apps/web` is no longer a placeholder; README setup notes for the web app and `CORS_ORIGIN`
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `CORS_ORIGIN` (API, optional), `NEXT_PUBLIC_API_URL` (web)
- **Tests:** API CORS origin test; web Jest smoke tests for each route page and layout plus the three state components
- **Decisions:** Next.js 16.4.5 (supports Node 22.14); no Hospigo UI concepts file, so a neutral shadcn style; Jest for web tests because it is already the API runner; did not add `eslint-config-next` because it requires ESLint 9 and the repo stays on ESLint 8
- **Follow-ups and open items:** Step 6 replaces the auth-guard stub; remove `src/mock` when navigation comes from the API

## 2026-11-05 — Phase 1 — CI audit job uses npm ci --ignore-scripts

- **Commit hash(es):** (uncommitted)
- **Added:** nothing
- **Changed:** `audit` job install → `npm ci --ignore-scripts` (lockfile-only; skips prisma generate); `docs/ci.md` notes why
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** lint + format:check only (Actions not run locally)
- **Decisions:** audit does not need install scripts; `ci` job unchanged
- **Follow-ups and open items:** none for this tweak

## 2026-11-04 — Phase 1 — CI (GitHub Actions) + PR template + Dependabot

- **Commit hash(es):** (uncommitted)
- **Added:** `.github/workflows/ci.yml` (lint, format:check, API build, create-roles against Postgres 16 + Redis 7 services, API tests; report-only audit job); `.github/dependabot.yml` (weekly npm + github-actions); `.github/pull_request_template.md`; `docs/ci.md`
- **Changed:** README CI section + docs index; folder-guide entries for `docs/ci.md` and `.github/`
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none (CI bootstraps ephemeral roles/DBs on the runner only)
- **New .env keys (names only):** none
- **Tests:** local `npm test -w @hospigo/api` after adding CI files (unverified count here); real Actions validation on first push
- **Decisions:** Node 22 in Actions (matches local/README; no `engines` field yet); `HUSKY=0` in CI; audit report-only; no `secrets` context; per-run hex passwords for app roles; fixed CI-only Postgres service superuser password; both `DATABASE_URL_TEST` and `DATABASE_URL_OWNER_TEST` target `hospigo_test`
- **Follow-ups and open items:** confirm first Actions run on push; optionally add `engines.node` later; consider failing audit on high once noise is under control

## 2026-11-04 — Phase 1 Step 4 follow-up — rebuild guards, safety-net split, access/leak gaps

- **Commit hash(es):** (uncommitted)
- **Added:** rebuild URL/host/`current_database`/`is_test` guards + unit tests; access tests for inactive permission/role/role_permission/assignment-branch and deactivated branch_modules; leak test for cross-hospital `created_by`
- **Changed:** safety-net — `PrismaService`/`set_config`/`$transaction` have no allowlist; only `$queryRaw`/`$executeRaw` are path-allowlisted
- **Removed:** nothing
- **Fixed:** rebuild could previously DROP based on URL text alone
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** 118 passing on `hospigo_test` (twice)
- **Decisions:** local-host-only rebuild; BRANCH membership rule retained
- **Follow-ups and open items:** none for this follow-up

## 2026-11-04 — Phase 1 Step 4 follow-up — BRANCH scope requires user_branches

- **Commit hash(es):** (uncommitted)
- **Added:** AccessService tests for assignment-without-membership, membership-without-assignment, both-required allow, deactivated membership deny
- **Changed:** BRANCH-scoped `AccessService` grants now require active `user_branches` membership for that branch; HOSPITAL scope unchanged (no membership required)
- **Removed:** nothing
- **Fixed:** BRANCH access could previously succeed from assignment alone without membership
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** 105 passing on `hospigo_test` (twice)
- **Decisions:** membership is mandatory for BRANCH scope only
- **Follow-ups and open items:** none for this follow-up

## 2026-11-04 — Phase 1 Step 4 — Request context, TenantDb, AccessService, clean test DB

- **Commit hash(es):** `de40f04`, `decdbe3`, `2f1e366`
- **Added:** Jest globalSetup rebuild of `hospigo_test`; `RequestContext` ALS; `TenantDb` door; `AccessService`; safety-net scan; TenantDb / access / hospital-isolation leak tests
- **Changed:** Patients, UHID, field settings, ImportBatchService use TenantDb only; `PrismaService` no longer exported from `PrismaModule`
- **Removed:** manual `set_config` from feature services
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none (no schema change)
- **New .env keys (names only):** none
- **Tests:** 101 passing on `hospigo_test` (twice in a row from clean rebuild)
- **Decisions:** schema-drop rebuild (not drop database) to preserve CONNECT hardening; AccessService does not require `user_branches` for BRANCH-scoped grants (schema allows assignment without membership)
- **Follow-ups and open items:** Step 5–6 controllers/tokens; optional service path to fail APPROVED import batches; patient cross-branch visibility undecided

## 2026-11-04 — Phase 1 Step 3b-2 follow-up — Import tests + concurrency fixes

- **Commit hash(es):** `108606b` (fix), `a9d777e` (test)
- **Added:** full 6×6 DB status matrix; NULL-branch duplicate cases; raw SQL exception CHECK cases; unmatched-row catalog snapshot; concurrent approve/post/undo/approve-vs-fail; `import_types` DELETE/TRUNCATE refuse
- **Changed:** `ImportBatchService` locks batch rows with `SELECT … FOR UPDATE`; `fail()` accepts DRAFT|PREVIEWED only (mutual exclusion vs approve)
- **Removed:** nothing
- **Fixed:** same-status status UPDATE no longer no-ops (trigger raises); approve-vs-fail race both succeeding when approve won first
- **Database (migrations, roles, RLS):** in-place edit of unpushed `20261104200000_import_batches` — status no-op refused
- **New .env keys (names only):** none
- **Tests:** 78 passing on `hospigo_test`
- **Decisions:** APPROVED→FAILED stays legal at DB; service `fail()` stops at PREVIEWED so concurrent approve/fail has one winner
- **Follow-ups and open items:** optional service path to fail an APPROVED (not yet posted) batch without weakening the race

## 2026-11-04 — Phase 1 Step 3b-2 — Import batch tables and bookkeeping

- **Commit hash(es):** `2069aa3`, `41dc354`, `d992aa2`, `f2d9309`
- **Added:** `import_types` (global), `import_batches` / `import_batch_rows` / `import_exceptions`; DB state machine + immutability triggers; `ImportBatchService` / `ImportsModule`; import Jest suite
- **Changed:** `GLOBAL_TABLES` allowlists `import_types`; isolation fixtures cover new tenant tables; architecture notes for import design and UHID counter follow-up after patient import
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** `20261104200000_import_batches` — app SELECT/INSERT/UPDATE only on tenant import tables; SELECT-only on `import_types`; no HQ grants
- **New .env keys (names only):** none
- **Tests:** 71 passing on `hospigo_test` (prior 64 + import suite)
- **Decisions:** import types are data not code; `raw_values` JSONB allowed only as immutable audit/undo copy; no Excel parsing in this step
- **Follow-ups and open items:** Excel parsers and domain handlers per import type; patient-import must call `setStartNumber` past max imported UHID; auth/controllers/UI later

## 2026-11-04 — Phase 1 Step 3b-1 follow-up — UHID format immutability + DB-level tests

- **Commit hash(es):** `497c089`, `2c4678d`, `64088e8`
- **Added:** `uhid.db-level.spec.ts` — deferred FY/RUNNING_NUMBER triggers, counter raise-only, true 50-connection concurrency, NEVER vs FY boundary, app privilege checks
- **Changed:** `hospigo_app` on `uhid_format_configs` / `uhid_format_blocks` is SELECT+INSERT only (policies split); revoked DELETE on patient customisation tables
- **Removed:** app UPDATE/DELETE grants and FOR ALL policies on UHID format tables
- **Fixed:** format-config immutability for the app role (privileges + policies)
- **Database (migrations, roles, RLS):** `20261104190000_lock_uhid_format_immutability`
- **New .env keys (names only):** none
- **Tests:** 64 passing on `hospigo_test`
- **Decisions:** no all-role UPDATE/DELETE trigger on format tables (would break owner deferred-trigger tests); app immutability via grants/policies only
- **Follow-ups and open items:** apply migrate deploy on any non-test DB that still points at a separate `DATABASE_URL_OWNER` host/db if used in other environments

## 2026-11-04 — Phase 1 Step 3b-1 — Patients, field settings, UHID engine

- **Commit hash(es):** `cde436e`, `9acfe98`, `23edf0c`, `8cf75ae`, `f095275` (+ docs hash follow-up)
- **Added:** Patients + `patient_identifiers` (table only); patient field catalog/settings/custom fields; UHID format configs/blocks/counters; `PatientsModule` services (`PatientsService`, `PatientFieldsService`, `UhidService`); injectable clock; hospigo_security column-privilege test; patients/UHID Jest suite
- **Changed:** `hospigo_security` hospital update narrowed to `UPDATE (id)`; `GLOBAL_TABLES` allowlists `patient_field_catalog`; isolation fixtures cover new tenant tables; architecture docs for UHID/field settings/Aadhaar pending
- **Removed:** nothing
- **Fixed:** nested Prisma creates omit inherited `tenant_id` (composite FK); tenant `set_config` kept inside transactions for pool safety
- **Database (migrations, roles, RLS):** `20261104180000_tighten_hospigo_security_hospital_update`, `20261104180100_patients_and_identifiers`, `20261104180200_patient_field_settings`, `20261104180300_uhid_engine` — new migrations only (3a untouched). Patients/UHID/clinical: no grants to `hospigo_hq`. FY reset without FY block rejected in service + deferred DB trigger.
- **New .env keys (names only):** `PATIENT_SEARCH_MAX_PAGE_SIZE`
- **Tests:** 48 passing on `hospigo_test` (prior 34 + new isolation/UHID/field/security coverage); later raised to 64 with DB-level suite
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
