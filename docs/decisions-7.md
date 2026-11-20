# Decisions, Step 7 (reports and print templates): API and migration part

Branch `feature/phase2-step-7-reports-print-api`, made from `develop` after PR #52 (6a) and PR #53 (6b) were merged. Two small new migrations and two new API modules. **The screens (7-2 reports, 7-4 print views and the Printing settings screen) are not built yet**; they come next. 7c (doctor profile setup) is a separate later step.

## Answers from Rakshith (planning, 20 Nov)

1. A simple printable **prescription** is included.
2. One template **per hospital** for now (the table has a branch column for later).
3. The daily collection report has a print view **and a CSV download**.
4. **Pre-printed** mode with positions and offsets in mm is included.
5. A **different layout per doctor** (doctor name, qualifications, registration number, signature) is a future upgrade. Doctors will enter these details themselves during their own profile setup (step 7c). Questions for management are in `docs/handoff-phase2.md`.

## What was built

- **Daily collection report (7-1), no screen yet.** `GET /opd/reports/daily-collection?date=YYYY-MM-DD[&branch=ALL]` and the same as `GET /opd/reports/daily-collection.csv`. One day of the hospital's own time zone (from `opd_settings.timezone`), for the active branch, or with `branch=ALL` for every branch. Shows money collected, refunds **separately**, and the net, by payment mode, by doctor, by bill type (and by branch when combined); counts of visits (and cancelled ones), payments, refunds and bills. A payment counts on the day it was paid, a refund on the day it was approved and written, never on the day of the bill. The response also carries `ledger { paymentPaise, refundPaise, matches }`: the ledger (the book every payment and refund is also written to) added up for the same day; `matches` is false only if the books ever disagree.
- **Permission `opd.reports.read`** (new, deny by default). The system admin roles get it automatically; reception does not (reception holds the cash, not the books).
- **One new access rule, `AccessService.hospitalWideBranches(code, module)`.** Access is normally narrowed to the token's active branch, so even a SuperAdmin could not read other branches. `branch=ALL` is allowed only when the permission is held on EVERY active branch of the hospital (hospital-wide scope); branches where the OPD module is switched off are left out; otherwise `403 REPORT_SCOPE_FORBIDDEN`. A branch Admin of one branch (or two of three) cannot ask for all.
- **CSV:** one flat table (`date, branches, section, key, name, payments, refunds, collected_rupees, refunded_rupees, net_rupees, visits`, sections TOTAL, MODE, DOCTOR, BILL_TYPE, BRANCH), amounts in rupees from whole paise by integer arithmetic, UTF-8 with the mark Excel needs, `Content-Disposition: attachment`, `Cache-Control: no-store`. A text cell that starts with `=`, `+`, `-` or `@` gets an apostrophe in front (a doctor named `=SUM(1+1)` can never become a formula); a real number, even a negative net, is left alone; commas and quotes are quoted. **No patient data**, totals only. Looking at or exporting the report is audited (who, which day, which scope; no amounts).
- **Report indexes (migration `20261122091000_report_indexes`):** four indexes (payments, refunds, ledger by hospital, branch and time; visits by branch and date) so a day's report does not read the whole money history.
- **Print templates (7-3, migration `20261122090000_print_templates`).** One template per hospital (or branch) and document type: registration slip, receipt, prescription. Paper A4, A5, A6, label or custom (width and height in mm), orientation, margins, mode **FULL** (Hospigo prints the letterhead) or **PREPRINTED** (only the data, at positions in mm), and a layout (font size, header and footer text, logo, which fields appear, a whole-sheet nudge, positions per field). A hospital that saved nothing gets the built-in default (receipt A5 full; slip and prescription A4 full); nothing is seeded.
- **Built-in presets** (code, not rows): A4 full, A5 full, small label (100 x 50 mm, few fields), pre-printed stationery (240 x 140 mm, fields laid out in two columns so every field starts on the page).
- **Print template API:** `GET /print-templates` and `GET /print-templates/:docType` (any signed-in staff, because the print screens need them), `GET /print-templates/presets` (`hospital.settings.read`), `PUT` and `DELETE /print-templates/:docType` (`opd.settings.write` and the OPD module; DELETE goes back to the default). Every field is checked: unknown keys, numbers (one decimal at most, ranges), a paper without its size, margins that leave less than 20 mm to print, fields that do not belong to the document, positions off the page, positions on a FULL template. Refused with `400 PRINT_TEMPLATE_INVALID { field, reason }`. Saves are audited with the **names** of what changed, never the header or footer text.
- **Database guarantees for templates:** CHECKs repeat the size, margin and JSON-size rules; one template per scope and document (unique index); the branch must belong to the same hospital; the identity (hospital, branch, document, creator) can never change, even for the owner; the app role can change only the setting columns; forced row level security; no grants for the HQ and patient roles; nobody can truncate the table.
- **The prescription template already accepts the doctor details** (`doctorQualifications`, `doctorSpeciality`, `doctorRegistrationNo`, `doctorSignature`) so no template change is needed when step 7c adds them; they print only when present.

## Decisions made while building (not in the plan)

- **CSV is built in the API**, not the web server, so no web step is needed to download it.
- **"All branches" means hospital-wide access, not "several branches".** Simple and safe for release 1.
- **A day in the future is refused** (`400 REPORT_DATE_INVALID`), judged in the hospital's own time zone; so is a date before 2020 or one that is not a real calendar day.
- **Doctor rows of the report use the doctor of the visit** (a tests bill counts for the doctor of that visit; a refund is attributed the same way).
- **Bug found by the tests, fixed:** a negative net such as `-200.00` was written with an apostrophe because the formula protection treated `-` as dangerous; plain numbers are now left alone (unit-tested).
- **Bug found by the tests, fixed:** the pre-printed preset stacked 19 prescription fields down a 140 mm page; they now flow into a second column.

## Time zone bug found by the report's ledger check (fixed in this step)

The Postman run showed `ledger.matches = false` on the dev database. Cause: the dev Postgres runs in `Asia/Calcutta`; Prisma fills `@default(now())` columns in the app and sends the UTC digits unlabelled, and Postgres read them as IST, so every app-written time (`paid_at`, `refunded_at`, `bill_date`, `created_at`, audit times) was stored exactly 5h30 early. Ledger rows are filled by the database and were correct. Example: a payment at 1:03 PM IST (07:33 UTC) was stored as 02:03 UTC.

- **Fix:** every application connection (`prisma.service.ts`, `hq-prisma.service.ts`, `patient-prisma.service.ts`, test helpers) now opens its session with `-c timezone=UTC` (`database/pg-session.ts`). Times are stored as the real moment; **screens and reports still show hospital time (IST)** because the hospital time zone (`opd_settings.timezone`) is applied when displaying or cutting a day.
- **Test:** `database/utc-session.spec.ts`. Before the fix it failed with a 19 800 second error (5h30); after, it passes.
- **Dev data:** `postman/dev-fix-utc-timestamps.cjs` (git-ignored, dev only, dry run by default) moves `payments.paid_at`, `refunds.refunded_at` and `bills.bill_date` forward by 5h30 after checking every row against its ledger row. Other app-written columns of old dev rows (`created_at`, audit times) stay 5h30 early; they do not affect money or reports.
- **Check production:** if the production Postgres is not set to UTC, existing production-like data would have the same shift. Not applicable before the first release, but check it then.

## Tests

- New: reports endpoints (money, by mode, doctor and bill type adding up to the total, refunds on their own day, time zones, future date, branch and hospital scope, hospital-wide, the ledger check including a deliberate mismatch, CSV, permissions, audit), CSV helpers, template rules (every refusal field by field), template endpoints (defaults, presets, save, replace, audit, reset, concurrency, hospital isolation, module gate), template database rules.
- Existing tests extended on purpose: the hospital isolation spec has a sample print template row.

## Not in this part

The report screen (7-2) and the print views and Printing settings screen (7-4), the doctor profile step (7c), per-branch templates on screen, a visual template designer, day closing, Excel export.

## Follow-ups noticed, not fixed

- A hospital whose `opd_settings.timezone` was set to something Postgres does not know would get an error from the report (the settings screen must only offer real zones).
- The report is one day at a time; a date range would need its own design.
