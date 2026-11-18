# Engineering tracker (Phase 1 + Phase 2)

Status as of 17 Nov 2026: Phase 2 Step 3c merged (PR #41; `develop` at c32185f). Step 3d built (PR pending). API 314 tests, web 406 tests. Evidence is repo-local unless noted.

Planned order: 3d, 4a (migration part, then API part), 4b, 5a, 5b, 6a, 6b, 7, 7b, 8a, 8b, 9 (see `docs/plan-opd-first-flow.md`). Target for the first working OPD flow: Fri 27 Nov 2026 (quality first; tests and review gates are never shortened).

## Phase 2 (OPD)

| Step | Item                                              | Status      | Notes                                                                                                                               |
| ---- | ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Design documents                                  | Done        | `docs/schema-opd.md`, `docs/use-cases-opd.md`                                                                                       |
| 2    | Masters, settings and mock data                   | Done        | Migration + services + mock seed + tests                                                                                            |
| 3a   | Counters, patient search, register and update API | Done        | Counters + PermissionGuard + `/patients` API + tests                                                                                |
| 3b   | Reception web foundation + application frame      | Done        | PR #40: theme, UI kit, shell frame, `/auth/me` permissions                                                                          |
| 3c   | Reception patient screens, list API, UHID setting | Done        | PR #41 merged (develop c32185f). API 281, web 314 tests                                                                             |
| 3d   | SuperAdmin branch switcher                        | Done        | PR pending. API 314, web 406 tests. `docs/decisions-3d.md`                                                                          |
| 4a   | Visits, billing and cash payment (tables, API)    | In progress | Merged from 4a-1 + 4a-2 on 18 Nov. Part 1 (migration) committed fc119a0; part 2 (API) built, at review gate. `docs/decisions-4a.md` |
| 4b   | Reception web: visit and billing                  | Planned     |                                                                                                                                     |
| 5a   | Vitals, queue and consultation API                | Planned     |                                                                                                                                     |
| 5b   | Nurse and doctor web                              | Planned     |                                                                                                                                     |
| 6a   | Investigations and refunds API                    | Planned     |                                                                                                                                     |
| 6b   | Investigations and refunds web                    | Planned     |                                                                                                                                     |
| 7    | Print templates and reports                       | Planned     |                                                                                                                                     |
| 7b   | Settings screens                                  | Planned     | Custom required fields, required-field settings, UHID format creation                                                               |
| 8a   | NestJS 12 upgrade                                 | Planned     |                                                                                                                                     |
| 8b   | Excel upload of masters                           | Planned     |                                                                                                                                     |
| 9    | OPD hardening and exit                            | Planned     |                                                                                                                                     |

## Phase 1

| #   | Item                                | Status         | Evidence                                                                                                                                 |
| --- | ----------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Monorepo / packages                 | Done           | `apps/*`, `packages/shared`, npm workspaces                                                                                              |
| 2   | TypeScript strict + ESLint/Prettier | Done           | `tsconfig.base.json` strict; `npm run lint`; Prettier; husky pre-commit lint                                                             |
| 3   | Env / secrets management            | Done           | `.env` gitignored; `.env.example` placeholders; CI generates secrets; `docs/env-reference.md`                                            |
| 4   | Postgres roles + RLS                | Done           | create-roles; FORCE RLS; isolation specs                                                                                                 |
| 5   | TenantDb + AccessService            | Done           | `TenantDb`, AccessService deny-by-default                                                                                                |
| 6   | Auth (hospital/HQ) + web BFF        | Done           | Step 6a–6d; httpOnly cookies; `docs/api-auth.md`                                                                                         |
| 7   | Email activation / reset            | Done           | Step 6b mail queue + web pages                                                                                                           |
| 7c  | Patient OTP login API               | Done (Step 6c) | `/patient/auth/*`; global patient tables; `hospigo_patient` role; no hospital link yet                                                   |
| 7e  | Patient web login (BFF)             | Done (Step 6e) | `/patient/login`, `/patient`; `/api/patient-auth/*`; separate httpOnly cookies; no hospital link yet                                     |
| 8   | Exit demo shell from real session   | Done (Step 7)  | `/auth/me` branches + enabledModules; web module mapping + guard                                                                         |
| 9   | Concept UI (sample data)            | Partial        | OPD/HQ hospitals still sample; Sample data badge                                                                                         |
| 10  | Health checks                       | Done           | `/health`, `/health/details`                                                                                                             |
| 11  | CI/CD                               | Done           | `.github/workflows/ci.yml` — lint, build, tests, Postgres + Redis services, required check; `APP_URL` throwaway local; audit report-only |
| 12  | Automated tests                     | Done           | API ~174+; web ~82+; isolation, auth, theme-hardcode, scroll-lock, next-public-scan                                                      |
| 13  | Docs                                | Ongoing        | architecture, folder-guide, api-auth, ci, staging-checklist, this tracker                                                                |

## Security layer

| Item                              | Status | Evidence                                                                                                     |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Cross-tenant isolation tests      | Done   | `hospital-isolation.leak.spec`, RLS specs                                                                    |
| HQ vs hospital token kind refusal | Done   | `auth.endpoints.spec` / `auth.guard.spec`                                                                    |
| Lockout + IP rate limit           | Done   | Redis auth limiter specs                                                                                     |
| Refresh reuse detection           | Done   | hospital refresh family revoke                                                                               |
| First-live seed guard             | Done   | `assertDevTenantSeedAllowed`; production `isTest` refuse at API start                                        |
| npm audit (report-only)           | Done   | Step 7: high multer via `@nestjs/platform-express`; moderate js-yaml via `@nestjs/swagger` — do not auto-fix |
| Production seed / demo tenants    | Done   | `assertNoTestTenantsInProduction` uses `hospital.isTest`                                                     |

## Open items

| Item                          | Status | Notes                                                                                                                            |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Migration discipline          | Open   | Owner-only migrate; document release order                                                                                       |
| Release process               | Open   | Staging checklist exists; no formal promote runbook yet                                                                          |
| Logging / monitoring          | Open   | Nest logger + audits; no central APM                                                                                             |
| API docs (published)          | Open   | Swagger off in production; OpenAPI publish later                                                                                 |
| Load tests                    | Open   | Not built                                                                                                                        |
| Backups / FTP                 | Open   | Not built                                                                                                                        |
| WebSocket auth                | Open   | Socket.IO present; AuthGuard skips non-HTTP                                                                                      |
| Next 16 proxy rename          | Open   | Follow Next guidance when renaming deprecated proxy helpers                                                                      |
| Split / part payment          | Open   | UPI + cash on one bill, ONE receipt for all (decided 18 Nov); part payment as permissioned exception. See `docs/decisions-4a.md` |
| Same-day re-visit rule        | Open   | Charge once per patient, doctor and day? Pending talks with hospitals (Rakshith)                                                 |
| Follow-up days setting screen | Open   | Setting exists (`follow_up_free_days`); screen and API route in Step 7b                                                          |
