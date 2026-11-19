# Engineering tracker (Phase 1 + Phase 2)

Status as of 17 Nov 2026: Phase 2 Step 3c merged (PR #41; `develop` at c32185f). Step 3d built (PR pending). API 314 tests, web 406 tests. Evidence is repo-local unless noted.

Planned order: 3d, 4a (migration part, then API part), 4b, 5a, 5b, 6a, 6b, 7, 7b, 8a, 8b, 9 (see `docs/plan-opd-first-flow.md`). Target for the first working OPD flow: Fri 27 Nov 2026 (quality first; tests and review gates are never shortened).

## Phase 2 (OPD)

| Step | Item                                              | Status  | Notes                                                                                                                                                                          |
| ---- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Design documents                                  | Done    | `docs/schema-opd.md`, `docs/use-cases-opd.md`                                                                                                                                  |
| 2    | Masters, settings and mock data                   | Done    | Migration + services + mock seed + tests                                                                                                                                       |
| 3a   | Counters, patient search, register and update API | Done    | Counters + PermissionGuard + `/patients` API + tests                                                                                                                           |
| 3b   | Reception web foundation + application frame      | Done    | PR #40: theme, UI kit, shell frame, `/auth/me` permissions                                                                                                                     |
| 3c   | Reception patient screens, list API, UHID setting | Done    | PR #41 merged (develop c32185f). API 281, web 314 tests                                                                                                                        |
| 3d   | SuperAdmin branch switcher                        | Done    | PR pending. API 314, web 406 tests. `docs/decisions-3d.md`                                                                                                                     |
| 4a   | Visits, billing and cash payment (tables, API)    | Done    | PR #45 merged (visits, bills, receipts, payments, token queue gate, reception screens, repeat-visit window). `docs/decisions-4a.md`                                            |
| 4b   | Reception web: visit and billing                  | Done    | Reception visit and billing screens were built inside 4a part 3 and merged with PR #45                                                                                         |
| 5a   | Vitals, queue and consultation API                | Done    | PR #46 (split payment, one receipt) and PR #47 (queue, notes, vitals, prescription API) merged. `docs/decisions-5a.md`                                                         |     |
| 5b   | Nurse and doctor web                              | Done    | PR #51 merged (378e4cf): queue (waiting / completed today / all), vitals, consultation with auto-save, calendar. API 488, web 758 tests; Postman 60/60. `docs/decisions-5b.md` |
| 6a   | Investigations and refunds API                    | Planned |                                                                                                                                                                                |
| 6b   | Investigations and refunds web                    | Planned |                                                                                                                                                                                |
| 7    | Print templates and reports                       | Planned |                                                                                                                                                                                |
| 7b   | Settings screens                                  | Planned | Custom required fields, required-field settings, UHID format creation                                                                                                          |
| 8a   | NestJS 12 upgrade                                 | Planned |                                                                                                                                                                                |
| 8b   | Excel upload of masters                           | Planned |                                                                                                                                                                                |
| 9    | OPD hardening and exit                            | Planned |                                                                                                                                                                                |

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

| Item                          | Status      | Notes                                                                                                                                                                 |
| ----------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration discipline          | Open        | Owner-only migrate; document release order                                                                                                                            |
| Release process               | Open        | Staging checklist exists; no formal promote runbook yet                                                                                                               |
| Logging / monitoring          | Open        | Nest logger + audits; no central APM                                                                                                                                  |
| API docs (published)          | Open        | Swagger off in production; OpenAPI publish later                                                                                                                      |
| Load tests                    | Open        | Not built                                                                                                                                                             |
| Backups / FTP                 | Open        | Not built                                                                                                                                                             |
| WebSocket auth                | Open        | Socket.IO present; AuthGuard skips non-HTTP                                                                                                                           |
| Next 16 proxy rename          | Open        | Follow Next guidance when renaming deprecated proxy helpers                                                                                                           |
| Split payment (one receipt)   | Done (5a-1) | UPI + cash on one bill, ONE receipt for all: receipts table, API `payments` list, reception screen. See `docs/decisions-5a.md`                                        |
| True part payment (pay later) | Open        | Pay the rest later, visit queued before fully paid: needs a queue-gate change, an exception permission, and a new receipt for the later payment                       |
| Same-day re-visit rule        | Open        | Charge once per patient, doctor and day? Pending talks with hospitals (Rakshith)                                                                                      |
| Follow-up days setting screen | Open        | Setting exists (`follow_up_free_days`); screen and API route in Step 7b                                                                                               |
| Receipt layout settings       | Open        | Hospital header/footer, receptionist name, doctor on the bill, paper size as hospital settings (Step 7 and 7b)                                                        |
| Free repeat-visit window      | Done (rule) | Rule and setting `repeat_visit_free_hours` built in Step 4a (0 = off, demo seed 24). The Admin screen to change it is Step 7b; hospitals still to confirm the default |
| Cancel / no-show visit        | Open        | A paid visit that is never seen stays in the queue for ever (tagged "From <date>"). Needs a cancel route with a reason and a permission (Step 6 or later)             |
| Reception queue sign-off      | Open        | Reception now sees the branch queue read only (names, doctor, status, vitals state). Rakshith to confirm with the manager                                             |
| Vitals read audit             | Open        | Reads of vitals are not audited (only note reads are, as agreed). Revisit if the hospital asks                                                                        |
| Two tabs, one note            | Open        | Auto-save of the same note from two tabs: the last save wins (the completed note is frozen by the database)                                                           |
| Prescription print            | Open        | No printable prescription yet; print layouts are Step 7                                                                                                               |
| Patient phone for the doctor  | Open        | Not shown on the consultation screen (the API does not send it); add only if the doctors ask                                                                          |
| Cross-branch note history     | Open        | Previous visits list only the visits a doctor or nurse may already see in this branch                                                                                 |
| Doctor orders tests           | Open        | Described in UC-08 / UC-09 but not built in Step 5 (no table, API or screen). Planned with Step 6a                                                                    |
