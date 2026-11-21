# Hospigo: handoff for the next chat

## CURRENT STATE (read this first; last updated 24 Nov 2026, after Step 7d)

Everything below this section is history. Where it disagrees with this section, this section is right. **Do not redo anything listed as done.**

**Branch and commits.** Branch `feature/phase2-step-7-reports-print-api` (made from `develop` after PR #53). Commits on it, oldest first: `88a955c` (times stored as UTC), `6531210` (Step 7 API), `3cf1b5b` (Step 7 web: reports, designer, SuperAdmin queue), `31b73d0` (Step 7b: settings screens and help), the space review and history-back-button commit, the **Step 7c commit** and the **Step 7d commit** (`git --no-pager log -8`). **Nothing is pushed.** Rakshith pushes and opens ONE pull request for Steps 7, 7b, 7c and 7d together, into `develop` (check the base: it has slipped to `main` before). I never push.

**Done (built, tested, committed):**

- 6a and 6b (tests, refunds, cancellations): merged (PR #52, #53).
- Step 7: daily collection report (filters, branch names, calendar, Print menu with CSV, Excel, PDF), print templates and the Word-style designer, print views, SuperAdmin sees the OPD queue. `docs/decisions-7.md`.
- Step 7b: Settings screens: OPD rules, registration fields (own fields, dropdown choices), patient number (UHID) format, help block on every settings page. `docs/decisions-7b.md`.
- Step 7d: **Staff and roles** and **My profile for every role**. Settings pages **Staff** (add, change, switch off and on, resend the activation email, search, filter, pages, staff code format) and **Roles** (make roles by ticking permissions, ready-made starts). **My profile** (`/app/profile`) is now the page of every signed-in person: name and phone, email change (code to the NEW address), password change (own email typed, code, new password; all sessions end), plus the doctor part for doctors. Rules: an Admin gives only roles whose powers they hold (daily-work powers excepted), nobody edits their own roles or branches or switches themselves off, the last SuperAdmin stays, nothing is deleted. New migration `20261124090000_staff_and_roles` (`users.phone`, table `staff_code_settings`). `role.write` is kept off the Branch Admin role. `docs/decisions-7d.md` (with the adversarial self-review: safe to approve).
- Step 7c: doctor profile details (printed name, qualifications, speciality, registration number; department changed by an Admin only). **My profile** page for the doctor (user menu), **Doctors** settings page for the Admin (SuperAdmin all doctors, Branch Admin only doctors of their branch), a reminder on the consultation screen, and the prescription print fills the doctor lines. A completed prescription keeps a copy of the details taken by the database at completion. `docs/decisions-7c.md`. New permissions `opd.doctors.own`, `opd.doctors.read`, `opd.doctors.write`; new migration `20261123090000_doctor_profile_details`.

**Checks at this point:** API 798 tests, web 1481 tests, lint, format, TypeScript all green (the production build is run before the commit).

**Click-tested by Rakshith:** the report screen, print settings and designer, SuperAdmin OPD queue, and the look of the 7b screens. **Not yet confirmed by him:** the full working of the 7b screens and of 7c (My profile, Doctors page, the prescription print with doctor details, the consult reminder), the full working of 7d (Staff page, Roles page, the new My profile, the email and password codes with a real mailbox), and the four Postman collections written but not run by the assistant (they need the dev passwords): `postman/collections/hospigo-7-reports-print-templates...`, `hospigo-7b-settings...` (45 requests), `hospigo-7c-doctor-profile...` (34 requests) and `hospigo-7d-staff-roles...` (64 requests). The `postman/` folder is git-ignored; run them with the `Hospigo Local` environment.

**Before running anything after a pull:** `npm run prisma:migrate -w @hospigo/api`, then `$env:NODE_ENV="development"; npm run prisma:seed -w @hospigo/api` (roles get new permissions through the seed), then restart both servers.

**Click path for 7d (Rakshith, after migrate, seed and restart):** log in as the SuperAdmin of a demo hospital. (1) Settings, **Staff**: the list shows everyone; press **Add staff**, type a name and a new email, tick a branch and a role, press **Add and send email** (the activation mail goes to the dev mail provider; in dev the link is in the API log or mailbox). (2) **Edit** that person and change the phone; **Switch off** (it asks first) and **Switch on**. (3) **Staff code format** beside the list: change the start letters and digits, see the next code. (4) Settings, **Roles**: **Add role**, choose **Start from** Nurse, untick one power, **Save**; give that role to a person on the Staff page. (5) User menu, **My profile**: change name and phone; try **Change email** and **Change password** (needs the mail with the code). (6) Log in as a Receptionist: My profile exists, Staff and Roles do not.

**NEXT: Step 7e, image and logo upload** (not yet planned in detail; needs a plan, questions and "approved"): hospital logo, doctor signature or stamp, picture boxes in the print designer. Then **8a NestJS 12 upgrade**, **8b** Excel upload of masters, **9** OPD hardening and exit, then Phase 3 (LAB and PHARMACY, `docs/future-lab-pharmacy.md`). Separate steps agreed but not scheduled: **Doctor setup** (fees, timings, leave screens) and **HQ creates a hospital with its first SuperAdmin**. Still to review for space with a login of that role: consultation, vitals, reception visit and billing, tests billing, login and patient portal, HQ admin.

**Open questions and parked items:**

1. **Questions for the manager (on hold):** the medical council name next to the registration number (Rakshith parked it); plus the older list in the "Per-doctor prescription layout" section below (separate letterhead per doctor, signature or stamp, which hospitals use pre-printed stationery, printer type).
2. A Branch Admin of one branch can change the patient number format for the whole hospital (the format and counter are hospital-wide). Rakshith chose this; revisit if a hospital objects.
3. Existing hospitals on a real server need the seed (or a small script) run once so their system roles get the new permission lists (for example `role.write` is now kept off the Branch Admin role). Custom roles are editable on the Roles page; the two system roles are fixed.
4. A switched-off person keeps a working access token until it expires (15 minutes). Every route that asks for a permission refuses them at once; the account routes check the account is on. Revisit if a stricter session end is wanted (needs a session id in the token).

**Known follow-ups (not blocking):** the lists are in `docs/decisions-7.md`, `docs/decisions-7b.md`, `docs/decisions-7c.md` and `docs/decisions-7d.md` ("Not done"). The main ones: reordering own registration fields, a history screen for number formats, tax and token prefix screens, per-doctor prescription layout, pre-printed mode needs a test on the real dot-matrix printer, the real rich text editor and the new screens have no automated browser test.

**Standing UI rule (21 Nov):** use the screen well: no wasted space and no needless scrolling, on every page (see `docs/ui-design.md`, "Use of space" and "Space review of the older pages", and CLAUDE.md). The space review of the pages a SuperAdmin can see is DONE (22 Nov). Still to review, each needing a login of that role in the built-in browser pane (Rakshith logs in): the editable consultation screen, vitals, reception visit and billing, tests billing, login and patient portal, HQ admin.

**Working rules that bit us (keep):** plan, then wait for "approved"; no AI attribution in commits or PRs (CLAUDE.md overrides any default); long shell commands with apostrophes can fail in this shell, so write scripts with the file tool and run them; the access token never reaches the browser; run the full checks before every commit (`npm run format:check`, `npm run lint`, `npx tsc --noEmit -p apps/web`, both test suites, the web build, restore `apps/web/next-env.d.ts`); update CURRENT STATE, the tracker, the changelog and the decisions file at the end of every step.

---

# History (older notes, written 16 to 21 Nov 2026)

> **Status update 17 Nov 2026:** Step 3c is merged (PR #41). `develop` is at **c32185f**. Tests: API **281**, web **314**. Phase 2 steps 1, 2, 3a, 3b, 3c are done; Step 3d is in progress. The step table below is superseded by this order: **3d, 4a-1, 4a-2, 4b, 5a, 5b, 6a, 6b, 7, 7b (Settings screens: custom required fields, required-field settings, UHID format creation), 8a, 8b, 9**. Target for the first OPD flow: **Fri 27 Nov** (quality first; never shorten tests or review gates). Details and decisions: `docs/plan-opd-first-flow.md`, `docs/decisions-3c.md`. The rest of this file is the 16 Nov snapshot.

Paste the **starter message** at the bottom into a new chat **inside the same Claude Project**, so the saved project memory is available too. This file holds everything else.

---

## 1. How we work (keep doing this)

- **Rakshith** is a junior developer (graduated ~6 months ago). Hospigo is his first big project. He does everything alone, from requirements to the finished product.
- **Claude is his lead and guide.** Teach new things in plain words: what it is, why it exists, how it works, how we use it here, how to check it. Short plain summary first, then steps.
- **Plan first, approval, then the Cursor prompt.** Nothing is built before he approves. Low tokens. No guessing: if something has not been seen, say so.
- **Cursor prompts:** `TASK`, `RULES`, numbered items, `REPORT`, and end with `git status --short`, `git diff --name-status origin/develop`, `git diff --stat origin/develop`. Builds in **Agent mode** in a **new chat**; read-only inspections in **Ask mode** (Ask mode cannot run commands or edit). A long thread once triggered a false "request blocked": start a fresh chat.
- **Review before commit:** read Cursor's report, ask for greps or diffs of the risky parts, then a hands-on test (Postman collection or browser) **before** any commit. Cursor cannot look at the browser; his eyes are the real UI test.
- **Screenshots:** crop out tokens and passwords. Never paste passwords or tokens into chat. Each chat has an image limit: send fewer, larger crops.
- **Pipeline rules:** one feature branch per step from `develop`; PR into **develop** (the base has slipped to `main` three times, check the dropdown); required check `ci` (the `audit` job is red by design and not required); merge with a merge commit; only release PRs go develop to main. Use `git --no-pager`. Stop dev servers before `npm ci`. Before committing run `git checkout -- apps/web/next-env.d.ts`, `npm run format:check`, and check that `.env` is not staged. Never `npm audit fix --force`. Postman folders (`.postman`, `postman`) are git-ignored.
- **Standing rules:** zero hardcoding (settings, env, theme tokens, one typed copy file for UI text, scan tests enforce it); no table without row level security; money in integer paise, never edited or deleted (reversals only); audit stores field names, not personal values; Sukshema Hospital is only a reference example, never bend the product to it.

## 2. Where the code stands

| Item      | State                                                                  |
| --------- | ---------------------------------------------------------------------- |
| Repo      | GitHub `RAKSHITH-0804/Hospigo` (private)                               |
| `main`    | `312e804`, tag `v0.1.0` (Phase 1). Not updated since                   |
| `develop` | `c32185f` (PR #41 Step 3c, then docs PR #42). Release PR to main later |
| Tests     | API **281**, web **314**                                               |
| Open PRs  | Dependabot #29 and #30 (left for a dedicated upgrade session)          |
| Phase 1   | Done (Steps 1 to 7, staff, HQ and patient login)                       |
| Phase 2   | Steps **1, 2, 3a, 3b, 3c done**; 3d in progress                        |

**Phase 2 steps done:** 1 design docs; 2 OPD masters, settings, mock data (11 tables, price history append-only); 3a number counters (bill, receipt, refund, per-branch token) and patient registry API with permission guard (deny by default, route-scan test); 3b web foundation (permissions in `/auth/me`, one navy/blue palette and IBM Plex Sans for the whole product, collapsible sidebar, top bar, user menu, UI kit, staff copy file).

## 3. Pending Phase 2 steps (in order)

| Step   | What                                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3c** | Reception web: patients. Search, register, record view (tabs Overview, Visits, Bills), edit, registration slip print, the SuperAdmin "**Next UHID number**" card in Settings                              |
| **3d** | SuperAdmin branch switcher (new access token per branch; SuperAdmin only)                                                                                                                                 |
| **4a** | Visits, billing, payments API: visit and token, consultation bill, payments, ledger, queue gate, part payment (permission), Emergency flag, pending dues, counters-only-forward trigger, idempotency keys |
| **4b** | Reception web: visit and billing                                                                                                                                                                          |
| **5a** | Vitals, doctor queue, consultation and prescription API                                                                                                                                                   |
| **5b** | Nurse and doctor web                                                                                                                                                                                      |
| **6a** | Investigations bill and refunds (Admin approves) API                                                                                                                                                      |
| **6b** | Investigations and refunds web                                                                                                                                                                            |
| **7**  | Print templates (settings per hospital) and reports (daily collection)                                                                                                                                    |
| **8a** | NestJS 12 upgrade (before any upload endpoint)                                                                                                                                                            |
| **8b** | Excel upload of masters (fees, tests, medicines, staff)                                                                                                                                                   |
| **9**  | OPD hardening and exit: seed validation, staging check, UI guide PDF with screenshots, Phase 2 report                                                                                                     |

The first working OPD flow is complete after 3c, 4a, 4b, 5a, 5b. **Target Saturday 21 Nov, no slack**; if it slips, cut screen polish, never tests or money rules. Go-live track (outside Phase 2): logging and alerts, backup and restore drill, threat model and DPDP checklist, staging, rollback and runbook, ADRs.

## 4. Key OPD decisions (all confirmed by him)

- Consultation fee per doctor with a visit-type override; **follow-up within 7 days is free** (setting). Registration fee once per patient hospital-wide.
- Bill when the doctor is assigned (before consultation). Part payment only as a permissioned exception (reason, balance tracked). Tax/GST is a hospital setting, off by default.
- **Doctor queue** shows paid, part-paid and Emergency visits. Token: one series per branch per day across all doctors (T1 D1, T2 D4...), **resets automatically at midnight IST**.
- No refund once the consultation started; Admin approves refunds (reversal entries). Unavailable doctor shows "Not Available Now" and cannot be assigned; timings only warn.
- Tests the doctor orders appear automatically on a pending-investigations list at reception. Medicines, tests, fees, staff come by Excel (Step 8b); until then mock masters from the seed.
- Print layouts are hospital settings (paper, full or pre-printed, offsets); slip optional. No prescription templates, no discounts in release 1.
- UHID field label: **"Next UHID number"** (the next new patient gets exactly that number; raise-only; API already behaves so).
- Branch switcher: SuperAdmin only (hospital-wide scope). Others work in the branch of their access code. The top-bar branch chip is a read-only label for everyone.

## 5. Dev environment

- Servers (repo root): `npm run dev -w @hospigo/api` (port 3000), `npm run dev -w @hospigo/web` (port 3001). Open the web app at **`http://127.0.0.1:3001`** (never `localhost`).
- Database: `npm run prisma:migrate -w @hospigo/api`, `npm run prisma:seed -w @hospigo/api`. Tests: `npm test -w @hospigo/api`, `npm test -w @hospigo/web`. Memurai check: `memurai-cli -h 127.0.0.1 ping`. Mailpit: `.\mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025` (only for staff emails).
- Demo access codes: `demo-north-main`, `demo-north-east`, `demo-south-main`, `demo-south-west`. Mock staff and what each role gets: `docs/dev-accounts.md`. Passwords come from `.env` (`SEED_SUPERADMIN_PASSWORD`, `SEED_BRANCH_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`).
- Postman: collection **Hospigo** (login requests save `adminToken`, `receptionToken`, `nurseToken`), environment **Hospigo Local**. Access tokens last **15 minutes**: re-send the logins first. A 28-check registry collection exists (regenerate from `docs/api-opd.md` if needed).
- Design: reception look on the Claude canvas "Hospigo reception UI directions" (artboard D): https://claude.ai/artifact/JzZ9LzAvTUSxZYmspUvVmu . Written spec: `docs/ui-design.md`.
- Docs in the repo: `use-cases-opd.md`, `schema-opd.md`, `system-design.md`, `api-opd.md`, `api-auth.md`, `ui-design.md`, `ui-concepts.md` (original concepts), `dev-accounts.md`, `engineering-tracker.md`, `staging-checklist.md`, `env-reference.md`, `CHANGELOG.md`, `folder-guide.md`.

## 6. Step 3c: what to start with

1. A short **read-only Cursor inspection (Ask mode, new chat)** of the web code built in 3b: UI kit components and props, `callStaffApi`, `requirePermission`, the copy file pattern, how forms submit (server action or route handler) and keep tokens off the browser, existing tests and scans to extend.
2. Read `docs/api-opd.md`. Facts to use: field is `ageYears` (or `dateOfBirth`, never both); duplicate returns **409** `POSSIBLE_DUPLICATE` with `matches`, resend with `confirmDuplicate`; search needs exactly **one** of `uhid`, `phone`, `name` (name at least 3 letters, page size capped); the registering branch is always the token's active branch; UHID never changes; custom fields (DEMO_NORTH only) come from `GET /patients/form-config`.
3. Plan screens from design D: `/app/patients` (search + results table + pagination + quick view), `/app/patients/new`, `/app/patients/[id]` (record view with tabs; Visits and Bills tabs are empty states until 4b), edit, slip print (one default template with its paper size in config; template settings arrive in Step 7), and the "Next UHID number" card in `/app/settings` (needs `hospital.settings.write`).
4. Mock tiles and the doctors card from design D wait for Steps 4 and 5 (no fake numbers in real screens).

## 7. Known follow-ups (not blocking)

API: refresh-token reuse with several web servers (add a grace window before running more than one web server); `pg` deprecation warning after OTP verify; expired OTP row cleanup; counters-only-forward trigger (add with the bill tables in 4a); `number-series-format` requires a financial-year block even for series that never reset; older tests in `patients.uhid.spec.ts` and `access.service.spec.ts` depend on file order; split the long registry search test; staff API calls from the web server had no timeout before the new helper. Web: two tab-list `aria-label`s on `/login` and `/forgot-password` are inline; Next.js 16 wants `middleware` renamed `proxy`; `next/font` downloads the font at build time (vendor the files before go-live); the user menu shows every role as a badge (use "+N" later); Dashboard, IPD, Pharmacy pages are placeholders.

## 8. Decisions still needed from management (Harshad Sir)

OPD release-1 scope; WhatsApp/SMS provider, DLT registration and who pays; tax/GST rules; who may approve part payments; Aadhaar storage, referral consent and data retention (DPDP); Windows or Linux servers and one or two servers for go-live; domain layout; S3 product; data-loss target (nightly backups can lose up to a day; 15 minutes needs continuous log archiving); a paper downtime procedure for hospitals; capacity numbers in `system-design.md` are assumptions; how real hospitals get the Receptionist, Nurse and Doctor roles (only in the dev seed today).

---

## Starter message for the new chat

```
We are continuing Hospigo (Indigo multi-tenant hospital SaaS) in Phase 2 (OPD). I am Rakshith, a junior developer; you are my lead and guide: teach me how things work, plan first and wait for my approval, then give Cursor prompts, review the reports, and give me clear test steps and commit/PR commands. The project memory has the history; the handoff file below has the current state.

State (19 Nov 2026, end of day): Phase 2 Steps 1 to 5 are DONE and merged on develop (4a PR #45, 5a-1 PR #46, 5a-2 and 5a-3 PR #47, 5b PR #51; develop at 378e4cf; API 488 tests, web 758). The first bill-to-doctor OPD flow works end to end (register, bill, split payment, queue, vitals, consultation, prescription, complete, addendum). NEXT STEP: **6a** (investigations bill and refunds, API; a review gate because it touches money), then 6b (web), 7 and 7b (print templates, reports, settings screens), 8a, 8b, 9. See "Where to start Step 6" at the end of this file. Open items and decisions: `docs/engineering-tracker.md`, `docs/decisions-5a.md`, `docs/decisions-5b.md`.

Please start Step 3c: first give me the short read-only Cursor inspection prompt for the web code (Ask mode), then the 3c plan for my approval.

[paste the handoff file here]
```

## Where to start Step 6 (written at the end of 19 Nov 2026)

**Branch note:** the closeout docs commit (this section included) lives on the local branch `docs/phase2-step5-closeout` (develop + one docs commit) and is NOT sent as its own PR; create the Step 6a branch from that docs branch (`git checkout docs/phase2-step5-closeout` then `git checkout -b feature/phase2-step-6a-...`), so the docs go into `develop` with the 6a PR. If that docs branch was merged on GitHub instead, branch from `develop` as usual.

Start a new session, read the files named in `CLAUDE.md`, then plan 6a and WAIT for "approved" (Rakshith approves every plan; he reviews all of a step at once when he says so, and commits and pushes himself).

**What 6a/6b are (from `docs/use-cases-opd.md`, UC-12, and the step table above):** an investigations bill (tests ordered for a visit, billed like the consultation, payable in several modes with one receipt) and refunds: the Receptionist requests with a reason, an **Admin approves**; the system writes a reversal entry (the original bill is never changed; who, when, why recorded); refunds follow the original payment mode; **no refund once the consultation has started** (`opd_visits.consultation_started_at`, set by 5a-2). Cancelling a visit that was not started also voids its token. Cancel / no-show of a paid visit is a known open item (a paid patient who is never seen stays in the queue for ever).

**Gap to know about (found when planning 6a, 19 Nov):** the docs say tests the doctor orders appear on a pending-investigations list at reception (UC-08, UC-09), but Step 5 never built test ordering: there is no table, API or screen for it. Decide in the 6a plan where it belongs (a small "tests ordered" list in the consultation that feeds the reception list is the recommendation).

**What already exists and can be reused:**

- Money tables with database rules (append-only, ledger written only by triggers, bills equal their lines, receipts equal their payments): `docs/schema-opd.md`, migrations `20261118100000_visits_and_billing`, `20261119090000_split_payment_receipts`. `bill_type` already has `INVESTIGATION`; `ledger_entry_type` already has `REFUND` and `CHARGE_REVERSAL`; `charge_items` of kind `INVESTIGATION` and their price list exist (mock tests `INV001...`).
- Visit, bill, payment and receipt services and the split payment plan: `apps/api/src/modules/opd-visits/`. Patterns for a clinical module: `apps/api/src/modules/opd-clinical/`.
- Permissions are deny-by-default; admin roles are deliberately kept away from clinical and cash permissions (`ADMIN_EXCLUDED_PERMISSION_CODES` in `apps/api/prisma/seeds/reference.ts`); a refund approval needs its own permission (a review gate).
- Web patterns: `apps/web/src/components/opd/` (new-visit form with idempotency keys, payment lines, receipt, queue, consultation), `lib/opd/`, copy only in `config/staff-copy.ts`.

**Review gates in 6a (stop and ask, with the adversarial self-review):** the migration, permissions, anything that touches money, tenant isolation and RLS.

**Dev setup facts:** servers `npm run dev -w @hospigo/api` (3000) and `npm run dev -w @hospigo/web` (3001, open `http://127.0.0.1:3001`); after pulling run `npm run prisma:migrate -w @hospigo/api` and re-run the dev seed (`NODE_ENV=development npm run prisma:seed -w @hospigo/api`) so roles get new permissions; demo logins in `docs/dev-accounts.md` (access code `demo-north-main`; Rakshith logs in himself; passwords live in `.env`); Postman collections are in the git-ignored `postman/collections/` folder (4a, 5a-1 and 5a doctor queue exist; each step ships its own).

**Rakshith's working preferences (also in `CLAUDE.md`):** plain-words teaching, short summaries, no large pastes; no AI attribution lines in commits, PRs or files; screens must fit on one page where possible and avoid long scrolling; he tests by clicking and by running Postman.

## Update 20 Nov 2026 (Step 6)

6a (API and migration, commit c819fa6) and 6b (web, branch `feature/phase2-step-6b-tests-refunds-web`) are built and waiting for review and PRs. Read `docs/decisions-6a.md`, `docs/decisions-6b.md` and `docs/future-lab-pharmacy.md` (LAB and PHARMACY are Phase 3; the prescription reaches the pharmacy when the consultation is completed). Next after the 6a and 6b PRs: Step 7 (print templates and reports) and 7b (settings screens).

## Update 20 Nov 2026 (Step 7) and questions for management

6a (PR #52) and 6b (PR #53) are merged. Step 7 API and migrations are built and waiting for review (`docs/decisions-7.md`): daily collection report with CSV, print templates, report indexes. Next: 7-2 (report screen), 7-4 (print views and Printing settings, prescription print), then 7b (settings screens) and the separate **7c: doctor profile setup**.

**Per-doctor prescription layout (a future upgrade).** Rakshith's reference photo is a hospital's pre-printed continuous (tractor-feed, dot-matrix) stationery: fixed letterhead and the doctors' names and qualifications already printed at the edges, a large empty box for the data. Hospital and branch details are the same on every document; on **prescriptions** the doctor part changes. Doctors will enter their own qualifications, speciality line and registration number in their profile (step 7c); the prescription template already accepts those fields. Questions for management:

1. Does each doctor need a separate prescription letterhead, or one hospital letterhead plus a doctor line?
2. Which doctor details must print: name, qualifications, speciality, medical council registration number, signature or stamp image, clinic timings?
3. If the stationery already lists the doctors, the software must print only the data. Which hospitals will use pre-printed stationery?
4. Do doctors who work in more than one branch need different details per branch?
5. Does anyone verify the registration number (for example the Admin ticks "verified"), or is the doctor's entry trusted? Can the Admin correct a doctor's details, or only the doctor?
6. Should the system refuse to print a prescription when the doctor has no registration number, or print without it?
7. If a doctor changes their details later, old prescriptions must keep the details as they were (a completed prescription should store a copy of the doctor block when it is written).
8. Which printer is it (dot-matrix, continuous paper)? Pre-printed mode needs a real test on that printer.

**Update (Step 7 web built):** 7-2 (collection report screen with CSV and print) and 7-4 (print views for receipt, slip and prescription; Printing settings screen) are built on the same branch and wait for click-testing and review (`docs/decisions-7.md`, web part). Next: 7b (settings screens: needs new API routes for UHID format, follow-up days and required fields) and 7c (doctor profile setup: migration and API), then 8a, 8b, 9. One PR for all of Step 7 at the end (Rakshith's choice, 20 Nov).

**Update (21 Nov, Step 7-5):** the Word-style print designer (boxes on a page, API layout version 2) is built on the same branch and waits for click-testing (`docs/decisions-7.md`, last section). Also built since the first click-test: report sections (department, tests billed) and the Excel download (new dependency `exceljs` in `apps/api`). One PR for all of Step 7 at the end. Still to do: 7b (settings screens, needs new API routes), 7c (doctor profile setup), 8a (logo upload), 8b, 9.

**Update (21 Nov, Step 7b built):** the settings screens are built (OPD rules, registration fields, patient number format) with SuperAdmin and Branch Admin both allowed (`docs/decisions-7b.md`). Step 7 is committed (3cf1b5b); 7b is committed on top of it. Next: click-test 7b, then 7c (doctor profile setup), 8a (tracker says NestJS 12 upgrade, this file earlier said logo upload: Rakshith to confirm), 8b, 9.
