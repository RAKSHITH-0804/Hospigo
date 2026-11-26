# Phase 2 exit report (OPD)

Written at the end of Step 9, 24 Nov 2026. Evidence: the repo (`docs/decisions/`, `docs/engineering-tracker.md`, `docs/CHANGELOG.md`). **Manual test results: pending Rakshith** (he tests everything by hand at the end of Phase 2 with `docs/guides/manual-regression-checklist.md`).

## 1. What is built, per step

| Step  | What                                                                                                                                                                                                | Proof                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1     | Design documents (schema, use cases)                                                                                                                                                                | `docs/reference/schema-opd.md`  |
| 2     | OPD masters, settings, mock data (11 tables; prices append-only)                                                                                                                                    | tests                           |
| 3a    | Number counters, patient registry API, permission guard (deny by default)                                                                                                                           | tests                           |
| 3b    | Web foundation: theme, UI kit, shell, permissions in `/auth/me`                                                                                                                                     | tests                           |
| 3c    | Reception patient screens, list API, patient number (UHID) setting                                                                                                                                  | API 281, web 314                |
| 3d    | SuperAdmin branch switcher                                                                                                                                                                          | API 314, web 406, Postman       |
| 4a/4b | Visits, bills, receipts, cash payment, token queue gate, repeat-visit window, reception web                                                                                                         | PR #45, Postman                 |
| 5a    | Split payment (one receipt), queue, notes, vitals, prescription API                                                                                                                                 | PR #46, #47                     |
| 5b    | Nurse and doctor web: queue, vitals, consultation with auto-save                                                                                                                                    | API 488, web 758, Postman 60/60 |
| 6a/6b | Tests billing (investigations), refund requests and approval, refund web                                                                                                                            | API 556, web 927                |
| 7     | Print templates and designer, registration slip, receipt, prescription, daily collection report (Excel, CSV, print)                                                                                 | PR #54                          |
| 7b    | Settings screens (OPD rules, registration fields, patient number format, help blocks)                                                                                                               | PR #54                          |
| 7c    | Doctor profile (printed name, qualifications, registration number)                                                                                                                                  | PR #54                          |
| 7d    | Staff and Roles, My profile for everyone (email and password with a code)                                                                                                                           | PR #54                          |
| 7e    | Logo and signature pictures, picture boxes in the designer                                                                                                                                          | PR #54                          |
| 7f    | Audit fixes (text scan, registration fee after a refunded cancel, delete triggers, relative on slip)                                                                                                | PR #57                          |
| 8a    | NestJS 12, 5 high npm findings fixed                                                                                                                                                                | PR #58, audit 0 high            |
| 8b    | Hospital starter script, price change, Excel upload (tests, doctor fees, medicines), doctor availability                                                                                            | PR #60, Postman 27/27 (masters) |
| 8c    | Number series, payment modes, vitals fields, doctor fee fallback, token marker, queue filter, reference fields, leave requests, branch print templates, print values; UI fixes from the manual test | PR #61, Postman 135/135         |
| 9     | Hardening (app login loses DELETE, bills index, seed upgrade proof, Excel file clean-up), **per-branch doctor fees**, Postman collections in the repo, extended checklist, this report              | this PR (see below)             |

## 2. Test counts

| Suite                         | 8c final (baseline of Step 9) | End of Step 9                                                                                                                            |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| API (Jest)                    | 1025                          | **1045 (was 1025: +3 app login grants, +1 seed upgrade, +11 per-branch fees over HTTP, +4 fee lookup unit tests, +1 Excel branch fees)** |
| Web (Jest)                    | 1790                          | **1795 (was 1790: +5 Prices screen branch fees)**                                                                                        |
| Lint, format, 2 builds        | green                         | lint, format check, API build and web build green                                                                                        |
| Postman                       | 8c 135/135, 8b masters 27/27  | other collections: run by Rakshith                                                                                                       |
| Browser smoke (`npm run e2e`) | -                             | 19 browser tests green on an isolated stack (not CI)                                                                                     |
| Manual regression             | -                             | **pending Rakshith**                                                                                                                     |

## 3. Deferred: WAITING FOR THE MANAGER (not built, on purpose)

| Item                                                                           | Why waiting                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Part payment with a balance, the pending-dues list, balance collection (UC-16) | The API requires payment to equal the total; money rules need the manager's decision |
| The Emergency flag                                                             | Not specified                                                                        |
| Online booking and doctor slots (`/book/[code]` says "Coming soon")            | Is it in release 1?                                                                  |
| Cancelling visits that are not WAITING                                         | Changes money and refund rules                                                       |
| Branch Admin creating roles (own branch only)                                  | Roles are hospital-wide today; needs a design                                        |
| Medical council name next to the registration number                           | Parked by Rakshith, ask on demo day                                                  |

## 4. Known limits (accepted)

- A switched-off person keeps a working token for up to **15 minutes** (every permission-checked route refuses them at once).
- Web dates use **one time zone for the whole web app** (`WEB_REPORT_TIME_ZONE`), not the hospital's. India only for now.
- A leave request **follows the doctor's branch**: after a move it is decided by the new branch's Admin or a hospital-wide Admin.
- Patient search by a name fragment scans the table (330 ms at 200,000 patients); needs `pg_trgm` at that size.
- Existing hospitals on a real server need the seed run once so system roles get new permissions (proved by `system-roles-upgrade.spec.ts`).
- Patient-number format and counter are hospital-wide (a Branch Admin of one branch can change them for all).

## 5. Open decisions for Rakshith

1. **Registration fee and test prices:** a Branch Admin can change them for **every branch** (they are hospital-wide, permission `opd.prices.write`). Limit to hospital-wide Admins? (Doctor fees are already limited per branch.)
2. Hide nothing else: the Bill numbers menu is already hidden from Branch Admins.
3. Merge the three open Dependabot branches (minor and patch), one at a time after `ci`.

## 6. GO-LIVE BLOCKERS (not code of Phase 2; must be done before a real hospital)

| #   | Blocker                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **HQ hospital creation is manual** (runbook `docs/guides/new-hospital-runbook.md` only; no HQ screen)                                      |
| 2   | **Staging environment** (a copy of production with its own database, to test migrations and releases first; checklist in `docs/guides/`)   |
| 3   | **Backups with a tested restore** (a backup nobody restored is not a backup)                                                               |
| 4   | **Monitoring and alerts** (errors, slow requests, disk, backups failing)                                                                   |
| 5   | **Security review and DPDP checklist** (consent, retention, access log, breach procedure, data principal rights)                           |
| 6   | **SMS and WhatsApp provider with DLT registration** (patient OTP and reminders; today only a development provider that refuses production) |
| 7   | **Domain and SSL**                                                                                                                         |
| 8   | **Windows vs Linux** hosting decision (dev is Windows; production is not decided)                                                          |
| 9   | **Medical council name** next to the registration number (manager)                                                                         |
| 10  | **Dot-matrix pre-printed stationery test on real hardware** (the mode is built; never printed on the real printer)                         |
| 11  | The manager's decisions in section 3                                                                                                       |
| 12  | The full manual test, **pending Rakshith**                                                                                                 |

## 7. What Rakshith runs first

`docs/guides/manual-regression-checklist.md` (run the Postman collections first, in the order listed there).
