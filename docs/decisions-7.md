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

# Step 7, web part (7-2 collection report screen and 7-4 print views and Printing settings)

Built on the same branch after the API part. Web only: no API or migration change.

## What was built

- **Collection report screen (7-2):** `/app/opd/reports` (tab "Collection report", shown only with `opd.reports.read`). Date picker (not after today), Today and Yesterday links, "This branch" or "All branches" (the API refuses "All" without hospital-wide access and the screen says so), four tiles (Collected, Refunded, Net, Visits), a ledger line ("Matches the ledger" or a red alert), tables by payment mode, doctor, bill type and (combined) branch. Print button (print view hides the controls) and **Download CSV**. The page is a server component and the filters are a plain GET form, so it works without scripts.
- **CSV download:** `GET /api/staff/opd/reports/daily-collection.csv` passes the API file on **byte for byte** (so the Excel mark survives; `Response.text()` would drop it). File name is built from the checked date only.
- **Print renderer (7-4):** one `PrintSheet` for every document. FULL: hospital name, header lines, chosen fields with captions, footer, margins and nudge as padding. PREPRINTED: only the values, each at its mm position plus the nudge, no letterhead or captions. A field prints only if the template turns it on and it has a value. `@page` is the template's exact paper with margin 0.
- **Documents:** the **receipt** (visit receipt page), the **registration slip** and the new **prescription print page** (`/app/opd/visits/[id]/prescription`, linked from a completed consultation as "Print prescription") print through the hospital's template. Item order follows the API's field list (a test pins the two lists together).
- **Printing settings screen:** `/app/settings/printing` (any `hospital.settings.read`; changing needs `opd.settings.write`, so others see it read only). One document at a time: preset, "print through the template" switch, paper, width and height (label and custom), orientation, plain paper or pre-printed, margins, font size, header and footer lines, which fields, fine tuning, positions for pre-printed stationery, a **live preview at real paper size** and Save or "Go back to the built-in default" (asks twice). Refusals from the API are shown as plain sentences (field and reason), never the server text.
- **Route handlers:** `PUT` and `DELETE /api/staff/print-templates/:docType` (same-origin check, stale-tab branch guard, document type checked).

## Decisions made while building (not in the plan)

- **"Print through the template" switch (`enabled`):** off means the older simple receipt or slip is used. A prescription has no older printout, so it says "Printing prescriptions is switched off".
- **Fallbacks:** if the template cannot be loaded or is not a complete template, the receipt and slip pages show the older simple printout, never an error page. The prescription page shows a calm error.
- **Registration date is not printed yet** (`registeredOn`): the patient answer does not carry it. Doctor profile fields (department, qualifications, speciality, registration number, signature) have nothing to print until step 7c.
- **Prescription extras:** vitals and ordered tests are added only if the person may read them and the fetch worked.
- **The preview uses clearly marked sample data** (copy file: "Sample Patient", "UHID-SAMPLE"), with a note on the screen. It is not shown on any real record.
- **Report "today"** comes from `WEB_REPORT_TIME_ZONE` (default `Asia/Kolkata`, checked at start-up), report paper from `WEB_REPORT_PAPER_SIZE` and `WEB_REPORT_PAGE_MARGIN`.
- **Standard paper sizes are copied** into `lib/print/form.ts` for the preview (the API keeps the same numbers and checks them).
- The **investigations (tests) receipt** still uses the older simple receipt; it has no template yet.

## Tests

Web 927 to 1027 tests (98 suites): report helpers (dates, time zones, links), report component, CSV and print-template route handlers (byte pass-through, refusals, stale tab), layout maths, sheet rendering (FULL and PREPRINTED), document builders (pinned to the API field lists), template reader, form logic, the whole settings screen (presets, positions, save, refusal, double click, reset, read only), page tests for receipt, slip, prescription and settings, the Reports tab by permission, the consult screen link. A production build was run.

## Not verified here

Real printing: paper, margins and pre-printed positions must be tried on the real printer (a dot-matrix printer on continuous paper may need its own driver page size). Dark-mode print is forced to the system text colour in the print CSS.

## Follow-ups noticed, not fixed

- Registration date for the slip (needs the patient answer to carry it).
- The tests (investigations) receipt does not use a template yet.
- A visual drag-and-place designer for pre-printed positions (today numbers in mm).
- The logo option (`showLogo`) has no image to print yet (needs the upload endpoint, step 8a).

# Step 7 follow-up (after the first click-test, 20 Nov): report sections

Rakshith's feedback on the report: more ways to group, and Excel and PDF files.

- **New groupings (API):** `byDepartment` (the doctor's department; a doctor without one is grouped as `(none)`, shown as "No department") and `byTest` (each test billed that day: how many and the billed amount). **`byTest` is tests BILLED, not money collected**, because a payment pays a whole bill; a refund does not change it. The screen says so.
- **Sections choice:** the screen has a picker (mode, doctor, department, bill type, tests, branch). The same choice goes to the CSV through `?sections=MODE,TEST` (known names only, `400` otherwise). The report data itself is always complete; the choice only decides what is shown or written. The TOTAL row is always in the CSV.
- **CSV columns changed on purpose:** two columns were added at the end (`tests_billed`, `billed_rupees`) for the test rows.
- **PDF:** the browser's Print then Save as PDF (Rakshith's choice); no PDF library.
- **Excel (.xlsx): built** (`GET /opd/reports/daily-collection.xlsx`, web route and a Download Excel button). New dependency `exceljs` in `apps/api` (Rakshith approved, 20 Nov). A Summary sheet plus one sheet per chosen section; amounts are numbers in rupees from whole paise (a fractional amount is refused); every name is written as plain text, never a formula. The file goes out as bytes (`StreamableFile`): a bare Buffer would have been sent as JSON text (found by the test). The download is audited like the CSV.
- Tests: API 622 to 641, web 1027 to 1039.
- **Printing designer (Word-like) is the next big piece.** Decisions: built by us without a drag library; one screen (the old form becomes a Page panel inside the designer); one style per box (font size, bold, alignment per box); logo and image boxes are placeholders until the upload step (8a).

# Step 7-5: the Word-style print designer (API and web, 21 Nov)

Rakshith's request after the first click-test: the Admin must configure printing "like in Word": move boxes sideways and up or down, each text with its own size, later logos and more details.

## What was built

- **New layout format (version 2): boxes on the page.** A template's `layout` is `{ version: 2, fontSizePt, offset, elements[] }`. Each box has an `id`, a `type` (`FIELD` a value of the document, `TEXT` fixed words, `LINE` a rule, `IMAGE` the logo slot), a place and size in millimetres (one decimal) and ONE style: text size 6 to 72 pt, bold, italic, underline, alignment, font (Sans, Serif, Courier) and colour (black or grey). At most 40 boxes, a box must stay on the page, ids are unique, a field box names a value of that document, a text box has text (300 characters at most), the saved layout stays under 15 000 characters (the database limit is 16 000). Every refusal is `400 PRINT_TEMPLATE_INVALID { field, reason }`, for example `layout.elements.2.widthMm OUT_OF_PAGE`. **No migration:** the layout is a JSON column.
- **The hospital name is now a value of every document** (`hospitalName`, first in each list) so it can be placed, styled and removed like any other box.
- **Older (version 1) templates convert automatically**, when saved through the API (an older caller) and when read from the database (a row an earlier version wrote): the same fields become boxes, header and footer text become text boxes, pre-printed positions keep their places. The result is always version 2. The old validator is kept for version 1 input.
- **Presets and defaults are built as boxes** (`print-layout.ts`): plain paper starts with the hospital name (bold, centred), header, then caption-and-value rows (one column, or two when a document is too long); pre-printed stationery gets only values in two columns without captions or letterhead.
- **Plain paper vs pre-printed is one switch.** On pre-printed stationery only the VALUES of field boxes print (no captions, text, lines or logo: they are on the paper); the designer shows those boxes faded.
- **The designer (web), Settings > Printing:** a page at real size with rulers in millimetres and a dashed margin guide. Click to select, drag to move, eight handles to resize, arrow keys nudge (1 mm, Shift 5 mm, Alt 0.1 mm), Delete removes, Ctrl+Z, Ctrl+Y and Ctrl+D undo, redo and duplicate. A toolbar for the selected box (size, font, bold, italic, underline, alignment, colour, caption, exact left, top, width and height, order, duplicate, delete) and Add text, Add line, Add logo box. Left side: the Page panel (preset, switch, paper, size, orientation, plain or pre-printed, default size, margins, fine tuning of the whole page) and the list of values with a tick each. Snap to a grid (off, 1 mm, 5 mm), zoom 50 to 150 percent, and a **Print preview** that uses the same drawing code as printing, so what is seen is what prints. Undo and redo keep the steps of each document separately. A drag is one step, recorded when the mouse is let go.
- **Printing code:** `PrintSheet` now draws boxes for the receipt, slip and prescription pages; the receipt and slip fall back to the older simple printout when a template is missing, off or not version 2.

## Decisions made while building (not in the plan)

- Fonts: Sans, Serif, Courier. Colours: black and grey only (Rakshith left the two questions to my recommendation).
- A logo box shows a marker in the designer and prints nothing until the upload step (8a) gives it a picture.
- One style per box (a bold caption with a normal value is done with the caption setting of a field box, or two boxes).
- The sample values in the designer are clearly marked sample data; the hospital name is the real one.
- All the designer's numbers (limits, steps, zoom, grid) are in `apps/web/src/config/print.ts`.

## Tests

API 641 to 657 (rules for every box key, conversion from version 1, endpoints), web 1039 to 1101 (geometry, history, boxes, layout, sheet, documents, designer: select, drag, resize, keys, toolbar, undo, preview, save, reset, read only, pages). A production build was run.

## Not verified here

The feel of dragging with a real mouse and touch, and real printing (paper, margins, pre-printed alignment on the dot-matrix printer). Boxes whose text does not fit are not flagged yet.

## Follow-ups

- A warning when the text of a box is longer than its box.
- Several boxes selected at once, alignment guides between boxes, copy a layout from another document.
- Real logo picture and doctor profile boxes (7c, 8a).
- The Postman collection `hospigo-7-reports-print-templates` still sends version 1 templates (the API converts them); a version 2 body would be a nicer test.

## Fix after the first look at the designer (21 Nov): the whole page on every screen

The page was cut off: it was wider than its column and the Settings content area had a fixed maximum width (44 rem). Now:

- **Zoom fits the room by itself.** "Fit whole page" (the default) and "Fit width" measure the room (the window and the layout are watched) and size the page to it, so the whole page is visible on a phone, tablet, laptop or very large display; fixed zooms 50 to 300 percent stay available. Boxes keep their millimetres at any zoom, and dragging stays exact (`lib/print/zoom.ts`, numbers in `config/print.ts`).
- **The Printing section uses the full width** of the screen (`settings-content-wide`); the other settings keep their narrow column.
- No second scrollbar inside the page area; the handles are bigger on touch screens.
- Tests: web 1101 to 1110.

# Step 7 follow-up (second click-test, 21 Nov): filters, calendar, Print menu, SuperAdmin, rich text designer

## Answers from Rakshith

- Report filters: choose ONE value per filter from a dropdown, filled from the hospital's own data (nothing fixed).
- SuperAdmin: sees everything, acts only where the permission is given.
- Designer: real Word-style rich text boxes.

## Report filters and branches (API)

- New `GET /opd/reports/filters` returns the choices: doctors, payment modes, departments, bill types, tests (capped by `maxTestOptions`) and the branches the caller may use.
- `daily-collection` (and `.csv`, `.xlsx`) take `doctor`, `paymentMode`, `department`, `billType`, `test` and `branch` (`ALL` or one branch id). Every value is checked against this hospital's data: unknown or other-hospital values give `400 REPORT_FILTER_INVALID`. All SQL uses bound parameters; the only literal is the fixed "(none)" department key.
- `AccessService.permittedBranches` lists the active branches where the caller holds the permission and the module is on, ignoring token narrowing. `ALL` still needs hospital-wide access (`403 REPORT_SCOPE_FORBIDDEN` otherwise). A named branch outside that list is refused.
- The ledger cross-check is `matches: null` while any filter is on (a filtered total cannot equal the whole ledger). The answer echoes `filters`. Audit stores filter names only, never values.

## Web: toolbar

- Dropdown per filter, a branch dropdown with branch names and "All branches" last, the new calendar with Today and Yesterday inside, and one Print menu holding Print, CSV, Excel and PDF (browser print to PDF).

## SuperAdmin

- SuperAdmin now holds every read permission, so the OPD queue and its tabs (All, Waiting, Completed) show. Actions follow the role's grants. `SUPER_ADMIN_EXCLUDED_PERMISSION_CODES` in `prisma/seeds/reference.ts` lists what stays off; `ensureSystemRolesForTenant` also removes a code that was later excluded. Existing databases need a re-seed.

## Print designer, layout version 3 (rich text)

- Version 3 boxes: `RICH` (paragraphs of runs: text or a value, each with size, bold, italic, underline, font, tone; paragraphs have alignment), `LINE`, `IMAGE`. Versions 1 and 2 are still accepted and converted to 3 on save and on read (a FIELD box becomes words plus a value; a TEXT box becomes one paragraph).
- Limits: 40 boxes, 15000 characters of text in total. A paragraph whose values are all empty is not printed; on pre-printed stationery only values print.
- Web editor is TipTap 3 with two custom parts: style attributes (size, font, tone) and an inline value token. Only whitelisted marks survive the conversion back (`editor-model.ts`), so pasted formatting cannot leak into a template. Typing in a box is ONE undo step; with the cursor in a box the ribbon acts on the selected words, otherwise on the whole box.

## Tests

- API 684 tests, web 1182 tests, lint, format, types and the production build are green. `printing-settings.spec.tsx` was rewritten for rich boxes with a stand-in editor (the real TipTap needs a browser).

## Not verified here

- The real TipTap editor in a browser (typing, selecting words, ribbon, double click) has no automated test: it is on the click-test list.

## Follow-ups

- The Postman collection still sends layout version 1 (converted by the API); update it when convenient.
- Fonts available in the designer are three families (sans, serif, mono) on purpose; more need a decision.
