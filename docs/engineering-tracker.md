# Engineering tracker (Phase 1 + security layer)

Status as of Step 7 hardening. Evidence is repo-local unless noted.

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

| Item                 | Status | Notes                                                       |
| -------------------- | ------ | ----------------------------------------------------------- |
| Migration discipline | Open   | Owner-only migrate; document release order                  |
| Release process      | Open   | Staging checklist exists; no formal promote runbook yet     |
| Logging / monitoring | Open   | Nest logger + audits; no central APM                        |
| API docs (published) | Open   | Swagger off in production; OpenAPI publish later            |
| Load tests           | Open   | Not built                                                   |
| Backups / FTP        | Open   | Not built                                                   |
| WebSocket auth       | Open   | Socket.IO present; AuthGuard skips non-HTTP                 |
| Next 16 proxy rename | Open   | Follow Next guidance when renaming deprecated proxy helpers |
