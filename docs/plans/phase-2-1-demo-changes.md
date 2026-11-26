# Phase 2.1: Demo Changes

Source file for Claude Code. Written by Rakshith (with Claude) on 26 Nov 2026, after the manager demo of Phase 2 (OPD). Save as `docs/plans/phase-2-1-demo-changes.md`.

The demo went well. The next meeting is with HOSPITALS, so the product must look real and the workflow must match how hospitals like Sukshema work. This file lists every change, the decisions already made, and how to execute. Read all of it before doing anything.

## 0. How to work with this file (execution protocol)

1. Read `CLAUDE.md`, `docs/handoff-phase2.md`, `docs/exit-report-phase2.md` and this file. Then `git fetch`, check `git status` and `git log -1`. Phase 2 (Steps 1 to 9) must be merged into `develop`; if not, STOP and tell Rakshith.
2. Do the work in four steps, each its own branch, PR and report: **2.1a**, **2.1b**, **2.1c**, **2.1d** (section 3).
3. For each step: write a read-only PLAN first (what exists today, what changes, migrations, API, screens, tests, risks, cut line, estimate) and STOP for Rakshith's "approved". After approval, build the WHOLE step in one go (migrations, API, web, tests, docs, Postman) and give ONE short report. Never start code before the plan is approved.
4. You may give the plans for 2.1a and 2.1b together, but build them one at a time.
5. First create `docs/decisions/decisions-2-1.md` from sections 1 and 2 of this file (decisions, reversals of earlier rules, reasons). Keep it updated as the steps finish.
6. Rakshith has limited Claude usage: keep reports short (tables, no long prose), run the full test suites once at the end of a step, commit after every item, and if you are near your limit stop at a clean commit boundary and write the state into `docs/handoff-phase2.md`.
7. Claude Code only builds this phase (no Cursor).

## 1. Decisions (Rakshith, 26 Nov 2026)

1. Indigo users act as **Tenant Admin** inside hospitals: full configuration power, patient data visible, every view and every cross-hospital action logged and audited.
2. A completed consultation can be edited only by Super Admin and Admin (and Tenant Admin). The ORIGINAL IS KEPT; every edit saves a new version with who, when and why. Tests that were already billed follow the refund rules and are never silently changed.
3. Doctors see ALL patients of the hospital, read-only, with full history at once (no referral, no approval). The OPD queue still shows only their own assigned patients. Every view by someone other than the assigned doctor is logged (who, which patient, when). The manager still has to confirm the DPDP point (manager question 9).
4. An Admin with several branches signs in with the access code of one of his branches and gets a switcher limited to his assigned branches.
5. The patient card is built END TO END through normal browser or Windows-driver printing with an exact label page size, a preview and a test-print page. There is NO printer to test with, so do NOT build raw TSPL commands; describe that option and the hardware it needs.
6. Symptoms entered by reception are optional and editable until the doctor starts; they are printed on the patient report.
7. Age entry covers years, months and days (for babies).
8. The next demo date is NOT confirmed: keep the order 2.1a, 2.1b, 2.1c, 2.1d and give a cut line.
9. Demo data uses fictional hospital names that do not match real hospitals, and Indian names from different regions.

## 2. Earlier rules this phase REVERSES (record each with the old rule in decisions-2-1.md)

| Earlier rule                                                                           | New rule                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A completed note is frozen; the doctor adds addenda                                    | Only Super Admin, Admin and Tenant Admin edit it, as new versions                     |
| Admin roles have no clinical rights; SuperAdmin only reads the queue, vitals and notes | Admin and Super Admin may edit consultations                                          |
| Records are shared between doctors only through referral                               | Doctors see all patients hospital-wide (read-only, viewing logged)                    |
| Separate Indigo HQ login with no access to patient data                                | Indigo users sign in without an access code and act as Tenant Admin inside a hospital |
| The hospital SuperAdmin makes print templates and logos                                | Only the Tenant Admin does; hospitals choose among the templates                      |
| Role "Branch Admin" is for one branch                                                  | Role "Admin" can manage one or more branches                                          |
| The branch switcher is for SuperAdmin only                                             | An Admin with several branches gets a switcher limited to his branches                |

## 3. The changes (16 items) and the steps

| Step                                  | Items                  | Risk                                                           |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| **2.1a** Quick wins and clinical flow | 1, 2, 3, 6, 10, 14, 16 | Medium; migrations for symptoms and estimated date of birth    |
| **2.1b** Roles and access             | 8, 15, 11, 4, 5        | Highest; includes a SECURITY REVIEW gate                       |
| **2.1c** Approvals and notifications  | 7                      | Low                                                            |
| **2.1d** Showcase                     | 9, 13, 12              | Large visual work; data first, then templates, then dashboards |

### Item 1. Default print paper is A5

New prints default to A5. Each hospital then chooses its own paper size. The patient card stays a 2 x 4 inch label.
Check: a new hospital's receipt, slip and prescription start on A5; a hospital can switch to A4, A6, label or custom.

### Item 2. Symptoms (was Complaints), entered by reception

- Rename "Complaints" to "Symptoms" everywhere (copy file, consultation, prints).
- Reception can enter Symptoms while billing a visit. Optional; editable until the doctor starts the consultation. New field on the visit (migration).
- In the consultation the doctor sees a block: first line `<Reception name>: <symptoms>` (read-only text), next line a free-text box for the doctor's own symptoms.
- Symptoms print on the patient report.
  Check: reception types "Cold cough with fever since yesterday" at billing; the doctor opens the consultation and sees "<Receptionist name>: Cold cough with fever since yesterday" and an empty free-text line.

### Item 3. Separate Prescription print

- Keep today's Patient report exactly as it is (it also contains the prescription).
- Add a new PRESCRIPTION print: (1) hospital and doctor header, (2) the medicines and tests entered by the doctor, (3) the doctor's signature below.
- First check what today's "prescription" print contains and say so in the plan.
  Check: both prints exist, each with its own template list; the prescription print has no vitals or billing data.

### Item 4. Edit a completed consultation: Admin and Super Admin only

- Doctors can no longer change a completed consultation (prescription, tests, notes). Super Admin, Admin and Tenant Admin can.
- The original is kept. Every edit saves a new version with who, when and why (reason required). Prints show the latest version and mark it "Amended".
- Tests already billed follow the refund rules; an edit never silently changes a bill.
- Plan the version history (migration, append-only, RLS) and how it relates to the existing addenda.
  Check: a doctor cannot edit after Complete; an Admin edits with a reason; the old version and the audit entry remain.

### Item 5. Doctors see all patients hospital-wide

- Patients module: a doctor can open any patient of the hospital, read-only, with full history, immediately (reception may assign a patient to Doctor 2 when Doctor 1 is not available, and Doctor 2 needs the history at once).
- The OPD queue still shows only the doctor's own assigned patients.
- Every view of a patient by someone other than the assigned doctor is logged (who, which patient, when). Plan the log so it cannot be edited or deleted.
  Check: Doctor 2 opens a patient seen only by Doctor 1 and sees all visits; the view is logged; Doctor 2's queue shows only Doctor 2's patients.

### Item 6. Patient card (2 x 4 inch gummed label)

- Printer: TSC TTP-244 Plus, 4-inch desktop barcode label printer, 203 DPI, direct thermal or thermal transfer. Label size 2 x 4 inch (about 50 x 100 mm).
- Printed after the consultation payment, together with the receipt, ONLY where the hospital switches it on (a hospital setting). The receipt with patient details, doctor, fees and total is printed as usual.
- Content (see the Sukshema label): REG.N (patient number), NAME with relative (Mr. PRAVEEN S/O SHIVAPPA), Age and Gender, ADDRESS, MOBILE. Receptionist name where it fits. Everything comes from settings and fields, nothing hardcoded.
- No printer is available to test: build it through the normal browser or Windows-driver print with the exact label page size, a preview and a test-print page, with tests. Describe the raw TSPL option separately and do not build it.
  Check: preview shows the label at 50 x 100 mm; the setting switches the automatic print on and off per hospital.

### Item 7. Pending approvals badge and instant notification

- For Super Admin and Admin (everyone who may approve refunds): show a number badge next to the "OPD queue" menu name and on the "Refund requests" tab. It counts PENDING approvals only and disappears at zero. It is shown only to users with the approve permission, and the count is scoped to their branches.
- They are notified immediately when a request arrives: in-app notification (bell and toast) using the existing real-time channel. Push, SMS and WhatsApp come later.
  Check: a receptionist sends a refund request; the Admin sees the badge go up without refreshing; approving it lowers the count.

### Item 8. Roles: Tenant Admin, Super Admin, Admin

- **Tenant Admin** (Indigo users) and **Super Admin** (hospital owner or manager) have full software power.
- **Admin** is the current "Branch Admin" renamed, because in some hospitals one Admin manages two or more branches.
- Tenant Admin and Super Admin assign Admins to branches in ONE click (example: P1 works only in Main Branch; P2 works in three branches). Everything should be a one-click operation.
- Check how role assignments already carry several branches and how much is new. An Admin with several branches signs in with the access code of one of his branches and gets a switcher limited to his assigned branches.
- Rename the role in the UI and docs; keep stable role codes unless the plan shows a reason to change them. System roles stay fixed.

### Item 9. Realistic demo data (step 2.1d)

- Remove every name like Mock, Demo, Seed, Test, "Opd4a 1794986601631" from the demo data and screens.
- Fill the demo hospitals again with fictional but realistic names: Indian patient and staff names from different regions, fictional hospital and branch names that do NOT match real hospitals, realistic phone numbers, addresses, doctors with specialities and registration numbers, medicines and tests with prices, 60 to 90 days of history (visits, bills, payments, refunds, prescriptions) so dashboards have real-looking numbers.
- Demo data lives only in demo hospitals and never in a production hospital. Keep the seed idempotent and keep one clearly marked test tenant for automated tests.
- Aadhaar numbers in demo data are fake. The Aadhaar storage rules are still pending with the manager.

### Item 10. Date of birth first, age always live

- Registration: DOB is the default entry, age is the second option.
- Age is ALWAYS calculated from the DOB. Example: DOB 1-1-2000, registered on 26-11-2026 shows 26 years; on 2-2-2027 it shows 27 years.
- Age-only entry (the patient says "70 years"): store an ESTIMATED date of birth = today minus the years, months and days entered, and mark it as estimated, so next year the age shows 71. Babies: years, months and days. Propose the display rule (for example 2 y 3 m, 5 m 12 d).
- A real stored DOB is never changed by an age entry. Plan the migration for existing age-only patients and the effect on search, prints, reports and the duplicate check.
  Check: the three examples above, a baby of 5 months, and a patient who registered with age 70 a year ago.

### Item 11. Print templates and logos: Tenant Admin only

- Tenant Admin creates the print templates and logos, 2 to 3 templates per print type: Registration slip, Receipt, Prescription, Patient report (and IPD, Lab and others later). SuperAdmin and Admin do not edit templates or logos; the hospital only chooses among the templates made for it.
- Remove template and logo editing from Super Admin and Admin; plan what happens to templates and logos hospitals already made.

### Item 12. Dashboards with KPIs and charts (step 2.1d)

- The website looks empty. Make every role's dashboard real: KPI cards, charts, new colours, information related to the role. The next meeting is with hospitals, so it must impress, not look plain.
- Suggested content (propose the final list in the plan):
  - Receptionist: today's registrations, visits, collection, waiting patients.
  - Nurse: waiting for vitals, vitals recorded today.
  - Doctor: my queue, seen today, follow-ups, recent patients.
  - Admin: branch collection and its trend, visits per doctor, pending refund approvals, payment mix.
  - Super Admin: collection across branches, 14 and 30 day visit trend, top doctors, payment modes, refunds.
  - Tenant Admin: hospitals, modules switched on, staff counts, platform health.
- Charts: line (visits over 14 days), bar (collection per branch), donut (payment modes), and so on. Numbers come from real data through report endpoints, never fake numbers in code; the realistic demo data from item 9 gives them life.
- New colour palette from theme tokens only; responsive; loading, empty and error states.

### Item 13. Designed sample print templates (step 2.1d)

Ready-made, good-looking sample templates for every print (2 to 3 each), not plain. Take the Sukshema prints as the pattern, with FICTIONAL branding (do not copy Sukshema's name, logo or doctors):

- **Cash bill / receipt:** hospital name, address, phone, email and web in the header; the title OUT PATIENT CASH BILL; Bill No, Reg No, Patient Name, Age/Gender, Bill date; a table of Sl No, Particulars, Amount; Total amount; Payment details (receipt no, amount received, mode); Authorised signatory; an optional footer line (for example "Reports will not be preserved beyond a month").
- **Prescription:** hospital header with logo and tagline; patient line (name S/O, age, gender, mobile, city, address, UHID, date); Symptoms; Diagnosis; Prescribed lab tests; one vitals line (pulse, SpO2, blood pressure, respiratory rate, temperature, weight); a medications table (Medications with composition, Dose, Frequency, Duration); doctor signature.
- **Registration slip and patient card:** as in item 6 and the current slip.
- Every value comes from settings and fields; hospital name, logo, address and footer text are per hospital.

### Item 14. Receptionist name on prints

Print the receptionist's name (the person who billed or registered) on receipts, slips and the patient card where it fits.

### Item 15. Login page: no "Indigo HQ" tab

- Remove the "Indigo HQ" tab. One sign-in form: a BLANK access code means an Indigo user (login id and password only); an access code means a hospital user (access code, email, password).
- Design how an Indigo user then chooses a hospital and acts inside it as Tenant Admin; how every such action is audited (who, which hospital, what); and how the existing HQ tables, token and `hospigo_hq` database role change.
- Same error for a wrong id, a wrong password and an unknown code; keep the rate limits; no account enumeration.

### Item 16. Show and hide password

An eye button on EVERY password field in the web app (login, forgot and reset password, activation, change password, My profile) to show or hide the typed password. Accessible (button with a label, keyboard operable), text from the copy file.

## 4. Security review list for step 2.1b (the plan must cover each point)

- Tenant Admin token design: how an Indigo user acts inside a hospital without weakening tenant isolation; which database role it uses; how row level security still applies.
- Audit of cross-hospital actions (who, which hospital, which action, when), append-only.
- Brute force and account enumeration on the single sign-in form.
- Version history of consultations: append-only, RLS, who and why.
- The doctor patient-view log: append-only, RLS, no personal data in the log text.
- A switched-off Indigo user or Admin: the accepted 15-minute token window stays the same.
- Branch scope for an Admin with several branches: every list, report, price and queue respects the assigned branches.
- Say plainly if any request cannot be done safely and propose the safest alternative.

## 5. Rules for every step (from CLAUDE.md and the audit)

- No hardcoded values or UI text outside the copy file (`staff-copy.ts`); theme tokens only; loading, empty, error and retry states; lists paginated; layouts checked at wide, laptop and phone widths.
- Tenant isolation and forced RLS on every new table; deny-by-default permissions with route markers; audit logs hold ids and field names only (no free text or personal data); money is integer paise; append-only money and audit tables are never weakened.
- Migrations are named after the latest existing migration, applied ONLY to `hospigo_test`; Rakshith migrates his dev database. Never use `npm audit fix --force`.
- Stop the dev servers on ports 3000 and 3001 before `npm ci`. Use `git --no-pager`. No AI attribution lines in commits. Do NOT push; Rakshith pushes. PR base is `develop`.
- Update affected tests, the 14 committed Postman collections (do not run them; tell Rakshith what to run) and the browser tests (`npm run e2e`) for every change; extend `docs/guides/manual-regression-checklist.md`.
- Docs to update after each step: decisions-2-1, tracker, handoff CURRENT STATE, changelog, runbook, README.
- If a point is unclear, choose the safest option, note it, and keep going. Stop only if tenant isolation, money rules or an append-only guarantee would be weakened.

## 6. Questions still open for Rakshith

- Date of the next hospital meeting (decides the order and the cut line).
- Whether any item should be dropped if time is short (suggested cut order: item 12 charts beyond the KPI cards, then item 13 extra templates, then item 6 label polish).

## 7. Final report format for each step

1. Table: item, done / not done / stopped, one line each.
2. Every migration's SQL.
3. Exact test counts (baseline from the last merged state), lint, format check, both builds, e2e result.
4. For 2.1b: what the security review tried and found.
5. `git --no-pager log --oneline` for the branch, `git status --short`, `git diff --name-status origin/develop` (count only).
6. What Rakshith must run (migrate, seed, restart, Postman, e2e) and what to click.
7. The PR description (what, why, tested, database changes, risks, checklist).
