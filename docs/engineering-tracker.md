# Engineering tracker (Phase 1 + Phase 2)

Status as of 21 Nov 2026: Phase 2 steps 1 to 6b are merged; Steps 7, 7b and 7c are built and committed on `feature/phase2-step-7-reports-print-api` (one pull request for all three, not pushed yet). API 740 tests, web 1322 tests. Next: 7d (staff and roles). Start from `docs/handoff-phase2.md`, section CURRENT STATE. Evidence is repo-local unless noted.

Planned order: 3d, 4a (migration part, then API part), 4b, 5a, 5b, 6a, 6b, 7, 7b, 7c, 7d (staff and roles), 7e (image and logo upload), 8a, 8b, 9 (see `docs/plan-opd-first-flow.md`). Target for the first working OPD flow: Fri 27 Nov 2026 (quality first; tests and review gates are never shortened).

## Phase 2 (OPD)

| Step | Item                                              | Status           | Notes                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Design documents                                  | Done             | `docs/schema-opd.md`, `docs/use-cases-opd.md`                                                                                                                                                                                                      |
| 2    | Masters, settings and mock data                   | Done             | Migration + services + mock seed + tests                                                                                                                                                                                                           |
| 3a   | Counters, patient search, register and update API | Done             | Counters + PermissionGuard + `/patients` API + tests                                                                                                                                                                                               |
| 3b   | Reception web foundation + application frame      | Done             | PR #40: theme, UI kit, shell frame, `/auth/me` permissions                                                                                                                                                                                         |
| 3c   | Reception patient screens, list API, UHID setting | Done             | PR #41 merged (develop c32185f). API 281, web 314 tests                                                                                                                                                                                            |
| 3d   | SuperAdmin branch switcher                        | Done             | PR pending. API 314, web 406 tests. `docs/decisions-3d.md`                                                                                                                                                                                         |
| 4a   | Visits, billing and cash payment (tables, API)    | Done             | PR #45 merged (visits, bills, receipts, payments, token queue gate, reception screens, repeat-visit window). `docs/decisions-4a.md`                                                                                                                |
| 4b   | Reception web: visit and billing                  | Done             | Reception visit and billing screens were built inside 4a part 3 and merged with PR #45                                                                                                                                                             |
| 5a   | Vitals, queue and consultation API                | Done             | PR #46 (split payment, one receipt) and PR #47 (queue, notes, vitals, prescription API) merged. `docs/decisions-5a.md`                                                                                                                             |     |
| 5b   | Nurse and doctor web                              | Done             | PR #51 merged (378e4cf): queue (waiting / completed today / all), vitals, consultation with auto-save, calendar. API 488, web 758 tests; Postman 60/60. `docs/decisions-5b.md`                                                                     |
| 6a   | Investigations and refunds API                    | Done             | PR #52 merged (`docs/decisions-6a.md`). API 556 tests                                                                                                                                                                                              |
| 6b   | Investigations and refunds web                    | Done             | PR #53 merged (`docs/decisions-6b.md`). Web 927 tests                                                                                                                                                                                              |
| 7    | Print templates and reports                       | Built, committed | `88a955c`, `6531210`, `3cf1b5b`: daily collection report (filters, branch names, Excel, CSV, print), print templates and Word-style designer, print views, SuperAdmin reads the OPD queue. `docs/decisions-7.md`. Pull request with 7b, not pushed |
| 7b   | Settings screens                                  | Built, committed | OPD rules, registration fields (own fields, choices), patient number format, help block on every settings page; SuperAdmin and Branch Admin. `docs/decisions-7b.md`. Postman 7b written, not run                                                   |
| 7c   | Doctor profile setup                              | Built, committed | Printed name, qualifications, speciality, registration number; My profile, Doctors settings page, consult reminder, prescription print; copy kept on completed notes. `docs/decisions-7c.md`. Postman 7c written, not run                          |
| 7d   | Staff and roles                                   | **Next**         | Add users and roles for every department (Admin and SuperAdmin only); custom roles; activation by email; review gate. Needs a plan and questions                                                                                                   |
| 7e   | Image and logo upload                             | Planned          | Hospital logo, doctor signature or stamp, picture boxes in the print designer                                                                                                                                                                      |
| 8a   | NestJS 12 upgrade                                 | Planned          | Confirmed 21 Nov: 8a is the upgrade; image and logo upload is 7e                                                                                                                                                                                   |
| 8b   | Excel upload of masters                           | Planned          |                                                                                                                                                                                                                                                    |
| 9    | OPD hardening and exit                            | Planned          |                                                                                                                                                                                                                                                    |

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

| Item                          | Status         | Notes                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration discipline          | Open           | Owner-only migrate; document release order                                                                                                                                                                                                              |
| Release process               | Open           | Staging checklist exists; no formal promote runbook yet                                                                                                                                                                                                 |
| Logging / monitoring          | Open           | Nest logger + audits; no central APM                                                                                                                                                                                                                    |
| API docs (published)          | Open           | Swagger off in production; OpenAPI publish later                                                                                                                                                                                                        |
| Load tests                    | Open           | Not built                                                                                                                                                                                                                                               |
| Backups / FTP                 | Open           | Not built                                                                                                                                                                                                                                               |
| WebSocket auth                | Open           | Socket.IO present; AuthGuard skips non-HTTP                                                                                                                                                                                                             |
| Next 16 proxy rename          | Open           | Follow Next guidance when renaming deprecated proxy helpers                                                                                                                                                                                             |
| Split payment (one receipt)   | Done (5a-1)    | UPI + cash on one bill, ONE receipt for all: receipts table, API `payments` list, reception screen. See `docs/decisions-5a.md`                                                                                                                          |
| True part payment (pay later) | Open           | Pay the rest later, visit queued before fully paid: needs a queue-gate change, an exception permission, and a new receipt for the later payment                                                                                                         |
| Same-day re-visit rule        | Open           | Charge once per patient, doctor and day? Pending talks with hospitals (Rakshith)                                                                                                                                                                        |
| Follow-up days setting screen | Built          | Step 7b: Settings > OPD rules (`/app/settings/opd-rules`, `GET/PUT /settings/opd-rules`)                                                                                                                                                                |
| Receipt layout settings       | Mostly covered | The print designer (Step 7) lets an Admin place the hospital name, header and footer text and paper; check for a real gap after the demo                                                                                                                |
| Free repeat-visit window      | Done (rule)    | Rule and setting `repeat_visit_free_hours` built in Step 4a (0 = off, demo seed 24). The Admin screen is built in Step 7b (OPD rules); hospitals still to confirm the default                                                                           |
| Cancel / no-show visit        | API done (6a)  | Cancel request by reception, approval by an Admin (`/opd/visits/:id/cancel-requests`). Screens in 6b                                                                                                                                                    |
| Reception queue sign-off      | Open           | Reception now sees the branch queue read only (names, doctor, status, vitals state). Rakshith to confirm with the manager                                                                                                                               |
| Vitals read audit             | Open           | Reads of vitals are not audited (only note reads are, as agreed). Revisit if the hospital asks                                                                                                                                                          |
| Two tabs, one note            | Open           | Auto-save of the same note from two tabs: the last save wins (the completed note is frozen by the database)                                                                                                                                             |
| Prescription print            | Open           | No printable prescription yet; print layouts are Step 7                                                                                                                                                                                                 |
| Patient phone for the doctor  | Open           | Not shown on the consultation screen (the API does not send it); add only if the doctors ask                                                                                                                                                            |
| Cross-branch note history     | Open           | Previous visits list only the visits a doctor or nurse may already see in this branch                                                                                                                                                                   |
| Doctor orders tests           | Done (6a)      | API built in 6a (tests list, replace-the-list route, pending list at reception). The doctor screen is part of 6b                                                                                                                                        |
| Registration fee on cancel    | Open           | Cancelling a first visit can refund the registration fee line too; the once-per-patient record stays. Confirm with the hospital whether it is ever returned (6a)                                                                                        |
| Extra test after completion   | Open           | A doctor cannot add a test once the note is completed (no addendum-style order). Add only if the doctors ask (6a)                                                                                                                                       |
| Refund voucher print          | Open           | No printed refund voucher yet (Step 7 print templates)                                                                                                                                                                                                  |
| Decline all tests             | Open           | A patient who declines EVERY test cannot be recorded (the API needs one billed test per request); the tests stay on the pending list. Small API route needed (6b)                                                                                       |
| Payment rows in two places    | Open           | `new-visit-form.tsx` and `use-payment-rows.ts` hold the same row logic; move the older form onto the hook later (6b)                                                                                                                                    |
| LAB and PHARMACY              | Planned        | Phase 3, after the first OPD release. Requirements and open decisions: `docs/future-lab-pharmacy.md`                                                                                                                                                    |
| Doctor profile setup (7c)     | Planned        | Doctors enter their own qualifications, speciality line, registration number (later a signature or stamp image, after the NestJS 12 upgrade 8a) for the prescription. Own migration and permission, own-profile-only rule. See `docs/handoff-phase2.md` |
| Report timezone value         | Open           | The report uses `opd_settings.timezone`; the settings screen must only offer real time zones (7)                                                                                                                                                        |

## Step 7 follow-up (21 Nov)

| Item                                                           | Status              | Notes                                                  |
| -------------------------------------------------------------- | ------------------- | ------------------------------------------------------ |
| Report filters (dropdowns), named branch, Print menu, calendar | Done, not committed | API and web tested; click-test pending                 |
| SuperAdmin reads all OPD screens                               | Done, needs re-seed | Exclusion list in `prisma/seeds/reference.ts`          |
| Rich text print designer (layout v3, TipTap)                   | Done, not committed | Real editor untested automatically; click-test pending |

## Step 7b (21 Nov)

| Item                                        | Status         | Notes                                                                                                   |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| OPD rules screen and API                    | Built          | Free follow-up days and repeat-visit hours                                                              |
| Registration fields screen and API          | Built          | Standard fields on/off/required; own fields (text, number, date, dropdown) and choices; nothing deleted |
| Patient number (UHID) format screen and API | Built          | New format from now on; counter never goes back; asks twice                                             |
| Postman collection 7b                       | Built, not run | `postman/collections/hospigo-7b-settings.postman_collection.json` (git-ignored)                         |

## Where to resume (21 Nov 2026)

Done: everything up to and including Step 7c. Next: 7d (staff and roles), then 7e, 8a, 8b, 9. Do not repeat finished steps. Resume notes: `docs/handoff-phase2.md` (CURRENT STATE section).

## Step 7c (21 Nov)

| Item                                                    | Status       | Notes                                                                      |
| ------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| Doctor profile fields and API (`/doctor-profiles`)      | Built        | Doctor edits own; Admin corrects (SuperAdmin all, Branch Admin own branch) |
| Copy of doctor details on a completed note              | Built        | Taken by a database trigger; cannot be forged or changed                   |
| My profile page, Doctors settings page, reminder, print | Built        | Help block on both pages                                                   |
| Medical council name                                    | On hold      | Question for the manager                                                   |
| Signature or stamp image                                | Waits for 7e | Needs image upload                                                         |
