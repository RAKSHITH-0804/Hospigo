# Phase 2.1: the five pull requests (copy and paste)

The branches are stacked. Push and merge them in this order, each into `develop`, with a merge commit. After each merge, change the base of the next one to `develop` if GitHub did not do it for you.

## 1. `feature/step-2-1a-quick-wins`

**Title:** feat(2.1a): quick wins from the demo (symptoms, DOB first, A5 default, prescription / patient report / patient card prints, password eye)

- Reception can type symptoms while billing (editable until the doctor starts); the doctor sees them.
- Patient age: date of birth first, or years, months and days (estimated DOB shown with "~").
- Default paper A5 (setting), slim PRESCRIPTION, the old full print is now PATIENT_REPORT, new PATIENT_CARD (50 x 100 mm label) with an optional auto-print.
- Eye button on every password field; receptionist name on the receipt.
- Migrations: `print_doc_types`, `symptoms_card_paper`.
- Tests: API 1065, web 1816 at the end of this step.

## 2. `feature/step-2-1b-roles-access`

**Title:** feat(2.1b): Indigo roles and entry, Admin branch switcher, consultation amend and doctor clinical history

- Security gate: see decisions-2-1 (verdict: safe to approve).
- One sign-in form (blank access code = Indigo); Indigo Owner and Employee enter a hospital through a hidden flagged user; every entry is logged (append-only).
- A multi-branch Admin gets a limited branch switcher.
- Completed notes are amended as versions (Admin); addenda are retired; doctors can read a patient's history from other doctors (viewing is logged).
- Print templates and logos: Indigo Owner only.
- Migrations: `indigo_access`, `consultation_versions_view_log`.
- Newman and e2e green on the isolated stack.

## 3. `feature/step-2-1e-indigo-console`

**Title:** feat(2.1e): Indigo console (hospitals, onboarding, module switches, Indigo employees)

- Real hospitals list with Enter; onboard a hospital (branches, access codes, modules, roles, first SuperAdmin with a one-time password); module switches; Indigo employees and the hospitals each may enter.
- Not built: named-template library, terminology overrides, per-branch modules, starter masters from the console.
- Migration: `hq_reads_modules`. A new raw-SQL allowlist entry (fixed function `hq_create_first_superadmin`, values bound) is in the safety-net test: please review it.

## 4. `feature/step-2-1c-approvals`

**Title:** feat(2.1c): pending approvals badge, bell and new-request message

- `GET /opd/refund-requests/pending-count` (approvers only); badge on OPD queue and Refund requests, bell in the top bar, message on a new request.
- A light poll every 20 seconds (`WEB_APPROVALS_POLL_SECONDS`); no staff push channel exists yet. No migration.

## 5. `feature/step-2-1d-showcase`

**Title:** feat(2.1d): showcase seed and real dashboards

- `npm run prisma:seed-showcase -w @hospigo/api` (never in production): two fictional hospitals, regional names, doctors, masters, 60 days of history made through the real routes.
- `GET /dashboard/summary` and a dashboard on `/app` with KPI cards and charts from real rows; blocks follow permissions.
- Not built: designed sample print templates and the screenshot rounds.
- No migration.
