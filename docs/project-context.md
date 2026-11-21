# Hospigo: project context

Last updated 17 Nov 2026, after Phase 2 Step 3c (PR #41 merged, develop at 0866d73).
This file explains what Hospigo is and why it is built the way it is. The working rules are in `CLAUDE.md`. Current step status and the step list are in `docs/engineering-tracker.md`, `docs/handoff-phase2.md` and `docs/decisions-3c.md`. Where files disagree, the newest decision wins.

## 1. What Hospigo is

- Indigo's multi-tenant hospital management SaaS. One codebase. Each hospital is a tenant. India only, English only, online only (no offline mode), web first, mobile (React Native, Expo) after the web is working.
- Built by Rakshith (junior developer at Indigo, first big project, does requirements to delivery alone). Manager: Harshad Sir, who approved the tech stack.
- Hosting: Indigo's own servers (Windows for now; Linux vs Windows is open). Domain `hospigo.indigocomputers.in` (subdomain or path layout is open).
- First release = a complete working OPD block. Release-1 scope is still an open item with management.
- Sukshema Hospital and Nanjappa are only reference examples for hospital workflows. Never bend the product to them. Anything hospital-specific (print layouts, fields, fees, number formats) is a setting. Never hardcode a hospital name.
- MedicoERP is a different Indigo product. Do not touch it. Lessons carried over from it: one ledger, money as integer paise, never edit or delete money, imports as batches, zero hardcoding, tenant isolation, paginated lists, no double booking.

## 2. Stack

- API: NestJS, Prisma 7, PostgreSQL 16 with row level security (RLS) by `tenant_id`, Redis (Memurai on Windows, use `127.0.0.1` not `localhost`), BullMQ, Socket.IO (a library inside the API), JWT + RBAC with argon2, Mailpit for dev email, nodemailer.
- Web: Next.js 16 (App Router) + Tailwind. Web talks to the API only through Next route handlers (the token stays in httpOnly cookies, never in the browser).
- Planned: Puppeteer or PDFKit for PDFs, React Native (Expo) mobile.
- Storage: local-folder `StorageService` (path from `STORAGE_ROOT_PATH`), S3-compatible later. MinIO was removed. No base64 in the database.
- Notifications: SMS + WhatsApp (WhatsApp first), behind a provider interface with dev drivers until go-live. DLT registration, provider and who pays are with management.
- Monorepo: `apps/api` (backend), `apps/web` (frontend), `docs/`. One repo on purpose: shared lint/format/CI and one PR can change API and web together.

## 3. Architecture and security rules

- Modular monolith, API-first, no microservices.
- FORCE RLS on every tenant table. No table ships without RLS. Migrations run under a separate owner DB role.
- DB roles: `hospigo_owner` (migrations), `hospigo_app` (the API), `hospigo_hq` (only hospitals, branches, subscriptions, branch modules, first SuperAdmin; no patient or clinical tables), `hospigo_patient` (patient accounts only, own connection). Tests run on the separate `hospigo_test` database. Passwords only in `.env`.
- Login lookup is a SECURITY DEFINER function returning only the hospital id for active hospitals. Same response for unknown code or wrong password. Rate limited with our own Redis limiter. If Redis is down, login and refresh are refused (fail closed).
- Auth: access tokens 15 minutes; refresh tokens with rotation and reuse detection (reuse revokes the whole session family). Three separate JWT secrets (hospital staff, HQ, patient) plus a separate OTP hash secret. AuthGuard is global and deny by default (`@Public` / `@AuthenticatedOnly` / `@RequirePermission` on every route; a route-scan test enforces it).
- Audit log is protected from update, delete and truncate at the DB level. Audit stores field names, not personal values. Sensitive actions are audit-logged.
- Zero hardcoding: settings, env, theme tokens, one typed copy file for UI text. Scan tests enforce it.

## 4. Tenancy, branches, roles

- Hospital = tenant. Branches are flat (Main Branch, then any number), no sub-branches. Only Indigo creates branches and enables modules.
- Indigo creates the hospital, ONE SuperAdmin and enables the bought modules. The hospital then creates staff, sets permissions and uploads master data by Excel.
- Two-level control: Indigo enables modules (per hospital, then per branch); the hospital SuperAdmin decides what each staff member can do inside them. A SuperAdmin can only restrict branch modules, never add.
- Every BRANCH has its own Access Code. The branch is chosen by the code used at login (staff log into one branch, no picker). The SuperAdmin logs in with the Main Branch code and is the only one who switches branches (Step 3d). One staff account can have different permissions per branch.
- SuperAdmin and Admin are not hardcoded: a role is a permission set in the DB, and each assignment has a scope (whole hospital or specific branches). One SuperAdmin per hospital; one Admin per branch (created by the SuperAdmin).
- Access needs BOTH the Indigo-enabled module AND the role permission.
- Patient search is hospital-wide. One UHID per person per hospital across branches. Referral-only record sharing, emergency access with a reason. Money stays in the billing branch.

## 5. Data rules

- Delete rules: master data (staff, doctors, medicines, tests, prices) is deactivated or archived, never hard-deleted. Money, stock transfers and audit logs are never deleted or edited by anyone including SuperAdmin; corrections are reversal entries (who, when, why). Staff are disabled, not deleted.
- Money: integer paise, append-only ledger, bills and payments kept separate, versioned prices (old bills keep old prices), tax columns present but off by default (GST/tax is a hospital setting).
- Excel upload: one file per data type; re-upload updates rows, no duplicates; match only by unique business code; invalid or unmatched rows go to an exceptions list, never placeholder records. Every import is a batch (preview, approve, post, undo the whole batch), runs in the background with visible status, safe to run twice. Same engine for hospital and Indigo uploads.
- Every master table has a business code unique per hospital.
- First live site must be fully empty: no demo or test data in production (seed guards enforce it).

## 6. Patients and UHID

- UHID is generated automatically on every registration (never typed). Hospital-wide locked counter; patients registering at two branches at the same moment get different continuous numbers.
- The format is per hospital, built from blocks: fixed text, branch code, financial or calendar year, separator, running number; reset rule never or per financial year. Examples: `NHEL3502`, `1819/05187`, `2627/04824`. Formats are immutable once created (a new config is inserted); there is no UI yet to create one (Step 7 settings).
- "Next UHID number" (SuperAdmin setting): the next new patient gets exactly that number. Raise-only, reason required, audited, hospital SuperAdmin or Indigo only (not branch Admin).
- Patient fields are configurable per hospital (enable, required, label, order, custom typed fields, sections). Always required in code: name, age or date of birth (exactly one), phone. Aadhaar: protected table exists but stays unfilled until management decides storage rules.
- Patient accounts for the patient app are global (`patient_accounts`, no tenant), OTP login, first login auto-creates the account, linking to hospital patient records comes with OPD registration.

## 7. OPD decisions (all confirmed by Rakshith)

- Sukshema runs two separate systems today and Hospigo must replace both (registration/UHID/slip, and doctor assignment/vitals/prescription).
- Bill is made when the doctor is assigned (before consultation). Consultation fee is per doctor with a visit-type override. Follow-up within 7 days is free (hospital setting). Registration fee appears once per patient, hospital-wide.
- Part payment only as a permissioned exception (reason, balance tracked). Payment modes: cash, UPI, card (reference for non-cash). No discounts in release 1. Refunds are approved by Admin (reversal entries); no refund once the consultation started.
- Doctor queue shows paid, part-paid and Emergency visits only, ordered by payment time. Nurses see all waiting patients and record vitals (vital fields configurable). An unavailable doctor shows "Not Available Now" and cannot be assigned; timings only warn.
- Token: one series per branch per day across all doctors, resets automatically at midnight IST. Two doctors on one day = two visits, each with its own bill and token.
- Bill, receipt and refund numbers are hospital-wide with a financial-year format from settings.
- Tests the doctor orders appear on a pending-investigations list at reception (release 1 bills tests only). Medicines come from the Excel list plus free text. No prescription templates.
- Print layouts are hospital settings (paper, full or pre-printed, offsets); the registration slip is a browser print view until Step 7. Daily collection report only in release 1. Starting roles: Receptionist, Nurse, Doctor (only in the dev seed so far).
- Full emergency/MLC workflow and the doctors' other daily tools are the next phase.

## 8. History and status

- Phase 1 (foundation) is done and released as `v0.1.0` on `main`: monorepo, API, Prisma + RLS, tenant context and leak tests, web shell, dual-path login (staff, HQ, patient OTP), email flows, hardening.
- Phase 2 (OPD) steps: 1 design docs (done), 2 masters/settings/mock data (done), 3a counters + patient registry API (done), 3b reception web foundation (done), 3c reception patient screens, patient list API, UHID number setting (done, PR #41), 3d SuperAdmin branch switcher (done), 4a visits/billing/payments API (done, PR #45), 4b reception visit and billing web (done, in PR #45), 5a split payment and vitals/doctor queue/consultation/prescription API (done, PRs #46 and #47), 5b nurse and doctor web (built, PR in review), 6a investigations and refunds API (done, PR #52), 6b their web (done, PR #53), 7 print templates, reports, Word-style print designer (built and committed, one PR with 7b), 7b Settings screens: OPD rules, registration fields, patient number format, help block (built and committed), 7c doctor profile setup (built and committed), 7d staff and roles (next), 7e image and logo upload, 8a NestJS 12 upgrade, 8b Excel upload of masters, 9 OPD hardening and exit report. Current state and the next step: `docs/handoff-phase2.md`, section CURRENT STATE.
- Target for the first working OPD flow was Sat 21 Nov and is at risk; the plan is a thinner first flow. If time slips, cut screen polish, never tests or money rules.
- Go-live track (outside Phase 2): logging and alerts, backup and restore drill (nightly backups can lose up to a day; 15 minutes needs continuous log archiving), threat model and DPDP checklist, staging, rollback and runbook, ADRs, vendoring the font files.

## 9. Open items with management (Harshad Sir)

OPD release-1 scope; WhatsApp/SMS provider, DLT and who pays; tax/GST rules; who may approve part payments; Aadhaar storage, referral consent and data retention (DPDP); Windows or Linux and one or two servers; domain layout; S3 product; data-loss target; a paper downtime procedure; capacity numbers in `system-design.md` are assumptions; how real hospitals get the Receptionist, Nurse and Doctor roles; emergency approver branch; doctor pay across branches; insurance later.

## 10. Pipeline lessons (do not repeat)

- One feature branch per step from `develop`; the PR goes into `develop` (the base slipped to `main` before: check it). Only release PRs go develop to main, with a proper title. Merge with a merge commit. Required check `ci`; the `audit` job is red by design.
- Never `npm audit fix --force`. Keep `@nestjs/core` in `apps/api/node_modules`. Stop dev servers before `npm ci`. After a stash restore run `prettier --write` (CRLF; `core.autocrlf` is true). Use `git --no-pager`. Answer No to the Prisma agent-skills prompt.
- Restore `apps/web/next-env.d.ts` before committing (Next.js rewrites it on every run).
- Dependabot PRs #29 and #30 are left open for a dedicated upgrade session. Planned manual upgrades: NestJS 12 (before the first upload endpoint), ESLint 10, dotenv 18, eslint-config-prettier 10; `@types/node` stays on 22.
- Migrations: edit unpushed local migrations in place; new migrations only after a push.

## 11. Dev environment

- Windows only. Git Bash terminal. npm workspaces (not pnpm). No Docker.
- Tools: pgAdmin, PostgreSQL 16, Postman (collection "Hospigo", environment "Hospigo Local"), Memurai, Mailpit at `D:\Indigo\Tools\mailpit` (run `mailpit.exe` from PowerShell or by double-click, not Git Bash; SMTP 1025, inbox http://127.0.0.1:8025).
- Commands and demo logins: `docs/dev-commands.md`, `docs/dev-accounts.md`.
