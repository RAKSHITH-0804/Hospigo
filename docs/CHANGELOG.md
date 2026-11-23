# Changelog

## How to add an entry

1. Add a new section under **Unreleased** (or promote Unreleased into a dated step when the step commits land).
2. Newest entries stay at the top.
3. Use the template below. Fill every field. If something cannot be verified from git or the repo, write `unverified` — do not guess.
4. Never put passwords, full connection strings, or real hospital names in this file.
5. Commit the changelog update with the step (or in the docs commit that closes the step).

### Entry template

```markdown
## YYYY-MM-DD — Phase X Step Y — <short title>

- **Commit hash(es):** <hashes or unverified>
- **Added:** …
- **Changed:** …
- **Removed:** …
- **Fixed:** …
- **Database (migrations, roles, RLS):** …
- **New .env keys (names only):** …
- **Tests:** <count and coverage, or unverified>
- **Decisions:** …
- **Follow-ups and open items:** …
```

---

## Unreleased

## 2026-11-23 — Phase 2 — Step 8a started: plan and decisions recorded

- **Added:** `docs/decisions/decisions-8a.md` (22 Nov decision to fold the 5 high npm findings into 8a; one PR with ordered commits; plan changes: multer fixed by `@nestjs/platform-express` 11.2.11, Nest 12 is ESM-only with a Jest-on-Node-22 risk, the three Prisma-tooling highs handled by an `effect` override).
- **Changed:** tracker rows 8a and 8b, handoff NEXT; corrected baselines (API 857, web 1581; Postman 7d 64 requests / 115 checks, last run 114 passed 1 failed and why; 7f 29 requests / 44 checks).
- **Tests:** unchanged.

## 2026-11-23 — Phase 2 — Step 7f: audit fixes (branch `feature/step-7f-audit-fixes`, not pushed)

- **Commit hash(es):** see `git log` on the branch (docs commits `fbc1ffc`, `a867ffa`, `8a468d2` travel with it).
- **Added:** database trigger that voids a registration fee when a cancelled visit's bill was refunded in full, with an update guard on `patient_registration_fees`; delete and truncate blocking triggers on `stored_images` and `uhid_counters`; slip field `relative`; `TOKEN_REQUIRED` rule for receipt templates; `/book/[code]` Coming soon page; `docs/decisions/decisions-7f.md`; Step 8c in the tracker and handoff.
- **Changed:** duplicate-patient warning needs mobile, name and date of birth; `confirmDuplicate` must be a real boolean; the copy scan test covers every folder under `apps/web/src`; sign-in, password, admin and Retry text moved to `staff-copy.ts`; decisions-4a, UC-15, schema-opd and the tracker updated.
- **Removed:** the mock booking screen (`components/book/booking-screen.tsx`, `mock/booking.ts`) and its tests (replaced by Coming soon tests).
- **Fixed:** registration fee could never be charged again after a cancelled first visit (when fully refunded).
- **Database (migrations, roles, RLS):** `20261126090000_registration_fee_void_on_cancel`, `20261126091000_image_and_uhid_counter_protection`. Applied to `hospigo_test` only; the dev database is migrated by Rakshith after pulling.
- **New .env keys (names only):** none.
- **Follow-up (same branch):** migration `20261126092000_registration_fee_void_on_later_refund` (a refund can still be made after a cancel, so the fee is also voided when later refunds reach the total of a cancelled visit's bill); the stale UHID comment in `uhid.service.ts` fixed; rule recorded: later migrations (8a, 8b, 8c) must be named after `20261126092000`.
- **Tests:** API 857, web 1581 (baseline 833 and 1576).
- **Decisions:** `docs/decisions/decisions-7f.md` (repeat-visit-free approved 22 Nov; SuperAdmin reads queue, vitals and notes; leave blocks, timings warn; Branch Admin and SuperAdmin raise the UHID counter; patient-update audit field names only; vitals ranges warn only; tax-on stays 501; registration fee charged again after a refunded cancelled first visit).
- **Follow-ups and open items:** DEFERRED pending the manager (part payment, pending dues, Emergency flag, online booking and slots); Step 8c scope; see decisions-7f "Not done".

## 2026-11-23 — Phase 2 — audit of Steps 1 to 7e (read-only)

- **Added:** `docs/audit/phase2-audit.md`: plan vs built table (294 rows), automated proof, security and money checks, top 10 problems, 15 decisions for Rakshith.
- **Changed / Fixed:** nothing in code. Docs only: the tracker rows "Prescription print" and "Doctor profile setup (7c)" were stale and now say Done; the handoff and README point to the audit.
- **Tests:** API 833 and web 1576 re-run, all pass; lint, format, API build and web build pass; migrations apply from zero on `hospigo_test`.
- **Follow-ups and open items:** the audit's findings (see the audit file and the handoff). Next is Step 7f (the audit gaps), then 8a.

## 2026-11-25 — Phase 2 — PR #54 merged (Steps 7 to 7e)

- **Commit hash(es):** merge commit `0762601` on `develop` (commits `88a955c` to `40faa56`).
- **Added / Changed / Fixed:** see the entries for Step 7e, Step 7d and the earlier Step 7 entries below.
- **Tests:** API 833, web 1576; `ci` green (the `audit` job is red by design).
- **Follow-ups and open items:** Next: Step 7f (gaps from the audit), then 8a (NestJS 12 upgrade); the unscheduled steps (Doctor setup, HQ creates a hospital) and the parked items are in `docs/handoff-phase2.md`.

## 2026-11-25 — Phase 2 — Step 7e, image and logo upload

- **Commit hash(es):** see `git log` (commit "Step 7e").
- **Added:** table `stored_images` and module `images` (`GET /images/:id`, `GET /settings/branding`, `PUT|POST /settings/branding/logo`, doctor signature routes under `/doctor-profiles`); Settings page Logo; signature or stamp box in My profile and the Doctors page; print slot `SIGNATURE` and "Add signature box" in the designer; pictures on the registration slip, receipt and prescription; Postman collection `hospigo-7e-pictures` (git-ignored).
- **Changed:** the doctor profile answers carry `signature` and `images`; the consultation `doctorDetails` carries `signatureImageId`; the copy kept on a completed note includes it; the web route layer can send a form (file) and pass on a file with its type; a signature box prints on pre-printed stationery.
- **Removed:** nothing.
- **Fixed:** none.
- **Database (migrations, roles, RLS):** `20261125090000_stored_images` (new table with row level security, edit and delete refused, one current picture per place; `consultations_guard` replaced to keep the signature id). No seed change. `STORAGE_ROOT_PATH` must point to a writable folder (already required).
- **New .env keys (names only):** none.
- **Tests:** API 833 (was 798), web 1562 (was 1481); lint, format, TypeScript and the production build green.
- **Decisions:** `docs/decisions/decisions-7e.md` (picture rules, who may look and change, frozen signature, adversarial self-review: safe to approve).
- **After the first click-test (25 Nov):** the settings menu is grouped under Hospital, People, Patients and OPD; the settings print preview marks an empty picture box and says the signature prints only on the prescription; the docs were moved into folders (`decisions/`, `reference/`, `guides/`, `design/`, `plans/`) with an index in `docs/README.md` and every reference updated; the 7e migration was applied to the dev database.
- **Follow-ups and open items:** clean-up of old pictures and orphan files, server-side resize, Postman 7e not run by the assistant, 8a NestJS 12 upgrade next.

## 2026-11-24 — Phase 2 — Step 7d, staff and roles, My profile for every role

- **Commit hash(es):** see `git log` (commit "Step 7d").
- **Added:** API modules `staff` (`/staff`, `/staff/options`, `/staff/code-format`, add, change, switch off and on, resend activation) and `account` (`/account/me`, email and password change with a code); `/roles` (list, catalog, templates, make, change, switch off and on); Settings pages Staff and Roles with help; My profile for every role (name, phone, email, password); staff code format card; Postman collection `hospigo-7d-staff-roles` (git-ignored).
- **Changed:** My profile moved from doctors only to every signed-in person (the doctor part stays inside it); the user menu shows it for everyone; the Branch Admin role no longer gets `role.write`; the web route filter forwards `retryAfterSec`.
- **Removed:** nothing.
- **Fixed:** a SuperAdmin whose token was narrowed to one branch looked as if they lacked a permission on other branches when giving roles (grant check now uses `permittedBranches`); switched-off people are refused on the account routes.
- **Database (migrations, roles, RLS):** `20261124090000_staff_and_roles`: `users.phone`, table `staff_code_settings` (row level security enabled and forced). Re-run the dev seed (roles and permissions).
- **New .env keys (names only):** none.
- **Tests:** API 798 (was 740), web 1481 (was 1322); lint, format and TypeScript green.
- **Decisions:** `docs/decisions/decisions-7d.md` (delegation rule, last SuperAdmin, codes for My profile, adversarial self-review: safe to approve).
- **Follow-ups and open items:** Doctor setup screens; HQ creates a hospital; 7e image and logo upload; medical council name (manager); Postman 7d not run by the assistant; a full audit-log screen.

## 2026-11-22 — Phase 2 — space review of the older pages

- **Commit hash(es):** see `git log` (commit "Space review").
- **Added:** `DataTable` options `hideOnPhone`, `nowrap`, `stackOnPhone`; `ReportActions`; `QuickLinks` (dashboard); styles `report-sections`, `patient-record-grid`, `dashboard-links`.
- **Changed:** OPD queue (one row for filters and status, cards on a phone), collection report (Print in the header, filters in one row, tables side by side), patients list on a phone, patient record (blocks side by side), dashboard (quick links instead of "Coming later"), doctors cards on a phone, PageHeader actions stay beside the title.
- **Removed:** nothing. **Fixed:** nothing.
- **Database:** none. **New .env keys:** none.
- **Tests:** web 1327 -> see the next entry for the final count; new tests for the table options, the dashboard links and the report actions.
- **Decisions:** `docs/design/ui-design.md` ("Space review of the older pages").
- **Follow-ups and open items:** review the screens that need other roles (consultation, vitals, reception, tests billing, login, portal, HQ).

## 2026-11-21 — Phase 2 Step 7c — doctor profile details

- **Commit hash(es):** the commit right after `31b73d0` on `feature/phase2-step-7-reports-print-api` (see `git log`).
- **Added:** doctor profile fields (printed name, qualifications, speciality, registration number); API module `doctor-profiles` (`/doctor-profiles/me`, list, correct); pages My profile and Doctors (settings); a reminder on the consultation screen; `doctorDetails` on the consultation and complete answers; the prescription print fills the doctor lines; permissions `opd.doctors.own`, `opd.doctors.read`, `opd.doctors.write`; demo details in the dev seed.
- **Changed:** `consultations_guard` and `consultations_before_insert` triggers (the database takes a copy of the doctor details when a note is completed); the list of person-only actions kept off both Admin roles now includes `opd.doctors.own`.
- **Removed:** nothing.
- **Fixed:** nothing.
- **Database (migrations, roles, RLS):** `20261123090000_doctor_profile_details` (4 columns on `doctor_profiles` with a length check, `consultations.doctor_details`, two triggers replaced). No grant change on `consultations` (the app cannot write the copy).
- **New .env keys (names only):** none.
- **Tests:** API 714 -> 740 (22 doctor profile endpoint tests, 4 copy tests, one list updated), web 1275 -> 1322. Lint, format, TypeScript and production build clean. Postman 7c written (34 requests), not run by the assistant.
- **Decisions:** `docs/decisions/decisions-7c.md` (Branch Admin only for doctors of their branch; department Admin-only; the database takes the copy; medical council name on hold; signature waits for image upload).
- **Follow-ups and open items:** medical council name (manager), signature or stamp image (7e), adding doctors (7d staff and roles), run the seed on existing hospitals after deploy.

## 2026-11-21 — Phase 2 Step 7b — settings screens (OPD rules, registration fields, patient number format, help)

- **Commit hash(es):** the commit right after `3cf1b5b` on `feature/phase2-step-7-reports-print-api` (see `git log`).
- **Added:** API module `hospital-settings` (`/settings/opd-rules`, `/settings/patient-fields` with built-in and custom fields and dropdown choices, `/settings/uhid-format`); web pages Registration fields, Patient numbers, OPD rules; an "About this page" help block on every settings page; six Next route handlers under `/api/staff/settings/`.
- **Changed:** the settings menu is now Registration fields, Patient numbers, OPD rules, Printing; the UHID format service can read and start a new format (`getFormat`, `changeFormat`), and the effective format is picked deterministically when two are saved at the same moment.
- **Removed:** nothing.
- **Fixed:** two administrators adding the same own field at once get "name already used" instead of a server error.
- **Database (migrations, roles, RLS):** none (tables existed). The running number counter never goes back when a new format counts in another period.
- **New .env keys (names only):** none.
- **Tests:** API 684 -> 714 (settings endpoints incl. isolation, validation, audit, counter carry-forward, concurrency), web 1182 -> 1275. Lint, format, TypeScript and production build clean. Postman 7b written (45 requests), not run by the assistant.
- **Decisions:** `docs/decisions/decisions-7b.md` (SuperAdmin and Branch Admin may both change these settings; nothing is ever deleted; a Branch Admin changes the number format for the whole hospital; help block closed by default).
- **Follow-ups and open items:** reordering own fields, number format history screen, tax and token prefix screens, per-branch number formats; Rakshith to confirm what 8a is.

## 2026-11-21 — Phase 2 Step 7 — reports, Excel, print templates, Word-style designer, SuperAdmin read access

- **Commit hash(es):** `88a955c` (times stored as UTC), `6531210` (API), `3cf1b5b` (web, designer, filters, SuperAdmin).
- **Added:** daily collection report (JSON, CSV, Excel; filters doctor, payment mode, department, bill type, test, branch; sections), print templates (registration slip, receipt, prescription) with presets and pre-printed mode, the Word-style designer (TipTap rich text boxes, layout version 3), the report screen with calendar, Print menu, branch names; `GET /opd/reports/filters`; SuperAdmin now reads the OPD queue, vitals and notes.
- **Changed:** database connections use a UTC session (times are shown in the hospital time zone); `AccessService.permittedBranches`.
- **Removed:** nothing.
- **Fixed:** the ledger check found bills stored in local time (repair script in `postman/`); report print no longer shows the OPD tabs.
- **Database (migrations, roles, RLS):** `20261122090000_print_templates`, `20261122091000_report_indexes`.
- **New .env keys (names only):** `WEB_REPORT_TIME_ZONE`, `WEB_REPORT_PAPER_SIZE`, `WEB_REPORT_PAGE_MARGIN` (optional). New packages: `exceljs` (api), TipTap (web).
- **Tests:** API 556 -> 684, web 927 -> 1182 (lint, format, TypeScript, build clean).
- **Decisions:** `docs/decisions/decisions-7.md`.
- **Follow-ups and open items:** 7c doctor profile, logo upload, per-doctor prescription layout, test pre-printed mode on the real printer, management questions in `docs/handoff-phase2.md`.

## 2026-11-20 — Phase 2 Step 6 — investigations, refunds and cancellations

- **Commit hash(es):** 6a `c819fa6` (merged `f182860`, PR #52); 6b `45e40cd` (merged `4cc9575`, PR #53).
- **Added:** doctor test orders, investigations bill, refunds and visit cancellations (API) and their screens for doctor, reception and Admin.
- **Database (migrations, roles, RLS):** `20261121090000_investigations_and_refunds`.
- **Tests:** API 556 after 6a, web 927 after 6b.
- **Decisions:** `docs/decisions/decisions-6a.md`, `docs/decisions/decisions-6b.md`.
- **Follow-ups and open items:** see those files. Other fields: unverified here (see the decisions files).

## 2026-11-19 — Phase 2 Step 5 — split payment, doctor queue, consultation, vitals, prescription and the nurse and doctor screens

- **Commit hash(es):** 5a-1: d428b5b (migration), f75a5b4 (API and web), merged as f16e677 (PR #46). 5a-2 and 5a-3: 796c9eb, merged as 66ed5cd (PR #47). 5b: a9bff8e, merged as 378e4cf (PR #51).
- **Added:** one receipt for a split payment (several payment modes on one bill) and `GET /opd/payment-modes`; the clinical API (queue, start, draft note, prescription, complete, addenda, note read with audit, vitals, medicine search); the screens `/app/opd` (queue with Waiting / Completed today / All), `/app/opd/visits/[id]/vitals` and `/app/opd/visits/[id]/consult` (auto-save, one-line prescription, calendar for the follow-up date); `TextareaField` and `DatePicker` in the UI kit; Postman collections "5a-1 split payment" and "5a doctor queue".
- **Changed:** a visit can become COMPLETED only after its note is COMPLETED (database rule); the OPD queue API lists every open visit (not only today's) plus the visits completed today; the sample-data OPD queue page and its tests were removed; the dev Receptionist role may read the queue (read only); the Doctor and Nurse dev roles got the queue, vitals and notes permissions.
- **Removed:** `payments.receipt_number` (moved to `receipts`); the sample `OpdQueueScreen`.
- **Fixed:** parallel identical requests could answer 400 or 409 instead of the first visit (replay); two-click guards on Start, Complete, vitals and addendum now use a ref (state was too weak); a queue that went empty after midnight; a medicine that is not in the list could not be saved (now "use as typed" and a clear message).
- **Database (migrations, roles, RLS):** `20261119090000_split_payment_receipts` (receipts, receipt equals the sum of its payments, one mode once per receipt) and `20261120090000_clinical_notes_vitals_prescription` (consultations, addenda, visit_vitals, prescription_items; forced RLS, append-only and freeze triggers, extended visit guard). No grants for hospigo_hq or hospigo_patient.
- **New .env keys (names only):** `WEB_OPD_QUEUE_REFRESH_SECONDS`, `WEB_OPD_AUTOSAVE_SECONDS`, `WEB_OPD_PREVIOUS_VISITS_LIMIT`, `WEB_CALENDAR_WEEK_START` (all optional, defaults in `docs/reference/env-reference.md`).
- **Tests:** API 399 -> 488, web 501 -> 758 (lint, format and TypeScript clean). Postman 5a-1 36/36 and 5a doctor queue 60/60. Every new rule was removed one at a time and a test failed each time (a few equivalent cases are listed in `docs/decisions/decisions-5a.md` and `docs/decisions/decisions-5b.md`).
- **Decisions:** `docs/decisions/decisions-5a.md` and `docs/decisions/decisions-5b.md` (doctor sees own visits only; one row lock per visit; notes read audited; reception reads the queue; no patient phone on the doctor screen).
- **Follow-ups and open items:** cancel or no-show a visit; true part payment (pay later); reception queue sign-off by the manager; printable prescription (Step 7); vitals reads not audited; same note in two tabs (last save wins). See the Open items table in `docs/engineering-tracker.md`.

## 2026-11-17 — Phase 2 Step 3c — UHID sort, sidebar tooltips, settings structure, polish (F1–F4)

- **Commit hash(es):** (uncommitted)
- **Added:** API sort values `uhid_desc` / `uhid_asc` for `GET /patients` (`ORDER BY length(uhid), uhid COLLATE "C", id`); settings frame (`config/settings-sections.ts`, `/app/settings/[section]`, section nav, compact setting blocks); portal tooltip; `.visually-hidden`; slip page margin config
- **Changed:** UHID column header sorts `uhid_desc` first, then `uhid_asc` (Registered on keeps newest/oldest; URL `col` is derived from `sort` when they disagree); all tooltips render in a portal on `document.body` (fixed position from the trigger rect, only after mount); collapsed sidebar text uses the visually-hidden class; `/app/settings` redirects to the first allowed section; settings description is "Hospital settings"; record page approximate age reads "N years (approx.)"; quick-view name link matches table links; slip `@page` margin 0 with its own padding token; selected Age / Date of birth mode is filled with the primary token
- **Removed:** descendant-selector hiding of collapsed nav labels (replaced by the class); the single-page settings screen
- **Fixed:** sidebar tooltips clipped by the sidebar's scroll container
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_PATIENT_SLIP_PAGE_MARGIN`
- **Tests:** API 274 → 281, web 290 → 314
- **Decisions:** UHID order uses plain character order (`COLLATE "C"`); known limit: after a UHID format change, formats are ordered by length then text; unknown sort value stays `400`
- **Follow-ups and open items:** sidebar collapsed-state sliver cause (see report)

## 2026-11-17 — Phase 2 Step 3c — web speed, live search, visual fixes (W1, W2, W3)

- **Commit hash(es):** (uncommitted)
- **Added:** `loading.tsx` skeletons for `/app/patients`, `/new`, `/[id]`, `/[id]/edit`, `/app/settings`; server first-paint fetch helper `lib/patients/server.ts`; list URL helpers `lib/patients/list-params.ts`; `redirectToRefresh()` (same-origin target only); `RecordTabs` and `PrintButton` as the only client parts of the record and slip
- **Changed:** `getSession` wrapped in React `cache()` (one `/auth/me` per navigation); `staffRoute` checks only the access cookie and maps upstream 401/403 (the API stays the authority; `permission` option removed); pages fetch their first-paint data on the server and pass props; live search (`GET /patients?q=`, debounce, abort, out-of-order guard, URL via `history.replaceState`); Register patient moved to the title row; record page: compact values, 3 columns on wide screens, estimated date of birth shows "Age N years (approx.)", real date shown like table dates, spaced phone everywhere; `CardHeader` padding now uses the card padding token; back arrow is a small ghost icon button; input font is the 13px control size on desktop and 16px only on touch (`pointer: coarse`); age/date-of-birth input has the control radius
- **Removed:** `classifyQuery`, `SearchMode`, `buildSearchPath`, the Clear button, the results chip, the web route `/api/staff/patients/search` (the API search endpoint stays), copy keys `clear`, `nameMinHint`, `resultsFor`, `searchedBy*`, `resultsTotal`, env key `WEB_PATIENT_SEARCH_MIN_NAME_LENGTH`
- **Fixed:** card headings touching the card edge (undefined spacing variable)
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_PATIENT_SEARCH_MIN_LENGTH`, `WEB_PATIENT_SEARCH_MAX_LENGTH`, `WEB_PATIENT_SEARCH_DEBOUNCE_MS`
- **Tests:** web 249 → 290 (see report)
- **Decisions:** web minimum search length 2 (API default); API 400 with `fieldErrors.q` shows the hint; server fetch 401 redirects to the refresh route
- **Follow-ups and open items:** empty `AuthGuard` wrappers (root layout and `AppShell`) left as they are; Next 16 does not print route sizes in `next build`

## 2026-11-16 — Phase 2 Step 3c — GET /patients free-text q (API)

- **Commit hash(es):** (uncommitted)
- **Added:** optional `q` on `GET /patients` (name/UHID/phone prefix OR arms; LIKE wildcards escaped); helpers in `patients-list-q.ts`
- **Changed:** list SQL composed with `Prisma.sql` parameters; sort still fixed fragments
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** none (no `pg_trgm` yet)
- **New .env keys (names only):** `PATIENT_LIST_Q_MAX_LENGTH`, `PATIENT_LIST_Q_MIN_NAME_LENGTH`, `PATIENT_LIST_Q_MIN_UHID_LENGTH`, `PATIENT_LIST_Q_MIN_PHONE_DIGITS`
- **Tests:** API suite green after q cases (see report count)
- **Decisions:** `q` cannot combine with `uhid`/`phone`/`name`; too-short `q` → `fieldErrors.q = INVALID`; contains-search and `pg_trgm` deferred
- **Follow-ups and open items:** consider `pg_trgm` when tables grow; contains phone search not supported

## 2026-11-16 — Phase 2 Step 3c — reception patients UI density and search (web)

- **Commit hash(es):** (uncommitted)
- **Added:** density tokens (`--size-control`, `--size-table-row`, `--space-field-gap`, `--space-form-section-gap`); patient form 12-col grid spans from `config/patients.ts`; DataTable optional sortable headers; PageHeader `backHref`; unified patients search toolbar + classifyQuery modes
- **Changed:** app shell viewport lock (fixed sidebar/top bar, only main scrolls); patients list URL `q`/`sort`/`col`; register/edit form denser layout with Age/DOB single cell (default Age) and header Register/Cancel via `form` attribute; UI kit controls ~32px / 13px body
- **Removed:** top-bar patient search (box, `/` shortcut, top-bar `q` handling) and its copy keys
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** web suite green after U1–U5 (see final report count)
- **Decisions:** leaving a half-filled register/edit form via Back discards silently (no confirm); phone display grouping from config; API search modes unchanged (name prefix, phone exact normalized, UHID exact)
- **Follow-ups and open items:** none for this UI pass

## 2026-11-16 — Phase 2 Step 3c — merge all patient fieldErrors in one 400 (API)

- **Commit hash(es):** (uncommitted)
- **Added:** `HospigoValidationPipe` soft-validates register/update bodies so DTO codes reach the service
- **Changed:** POST/PATCH `/patients` merge DTO + service fieldErrors into one 400 (no double-report per field); `message` shape unchanged
- **Removed:** none
- **Fixed:** missing name no longer hides phone/pincode/age-or-DOB errors
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** 260 passing in `@hospigo/api` (was 254; merged fieldErrors + settings/seed specs)
- **Decisions:** DTO code wins when both stages flag the same field; refresh cookie path unchanged (web-only concern)
- **Follow-ups and open items:** none for this slice

## 2026-11-16 — Phase 2 Step 3c — patients list, compact form, silent refresh (web)

- **Commit hash(es):** (uncommitted)
- **Added:** real `/app/patients` list from `GET /api/staff/patients` (sort/page/filter in URL); form sections from form-config with RELATIVE disclosure; required asterisks + fieldErrors mapping; `POST /api/auth/refresh-session` + `patientsApi` one-shot silent retry
- **Changed:** register/edit form compact grid and client-side all-fields validation with summary count; search row uses reserved hint space so Search does not jump; EmptyState optional action for write permission
- **Removed:** top-level “Enter a valid value” form banner as the primary validation UX
- **Fixed:** none
- **Database (migrations, roles, RLS):** none (web only)
- **New .env keys (names only):** `WEB_PATIENT_LIST_SORT_DEFAULT`, `WEB_PATIENT_PHONE_COUNTRY_PREFIX`, `WEB_PATIENT_PHONE_NATIONAL_LENGTH`, `WEB_PATIENT_PINCODE_LENGTH`, `WEB_PATIENT_AGE_MIN`, `WEB_PATIENT_AGE_MAX`, `WEB_PATIENT_AGE_MAX_DIGITS`, `WEB_PATIENT_DATE_LOCALE`
- **Tests:** 243 passing in `@hospigo/web` (was 237; list/form/session/handler specs)
- **Decisions:** refresh cookie path stays `/api/auth` (new refresh-session under that path); access token never in browser; form fields/sections/required only from form-config; list phone shown as stored
- **Follow-ups and open items:** edit still cannot clear a previously filled field (PATCH omits empties); visits/bills tabs remain placeholders

## 2026-11-16 — Phase 2 Step 3c — patient list, required fields, fieldErrors, sections, seed (API)

- **Commit hash(es):** (uncommitted)
- **Added:** `GET /patients` list/browse (sort newest/oldest/name_asc/name_desc; optional single filter; `createdAt` + `registeredBranchName`); `fieldErrors` codes on POST/PATCH validation 400s; form-config `section`; ~60 fake patients per DEMO hospital via `UhidService.allocateNextUhid`
- **Changed:** name, phone, and age-or-DOB always required (catalog `alwaysRequired` / combined rule); pincode must be 6 digits when provided; ValidationPipe exception factory attaches `fieldErrors`
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** `20261116180000_patient_list_sections_required` — patients `(tenant_id, created_at, id)` index; `patient_field_section` enum; catalog `default_section`; custom field `section`; phone + date_of_birth always required
- **New .env keys (names only):** none
- **Tests:** API registry list/sections/fieldErrors/pincode; seed guard + idempotent patient counts; register fixtures use shared phone helper
- **Decisions:** list is a new endpoint (search unchanged); custom fieldErrors keys use `custom.<code>`; ageYears appears in fieldErrors only for AGE_AND_DOB_BOTH; patient seed skips when tenant already has ≥ 60 patients
- **Follow-ups and open items:** web list UI and required-phone form wiring

## 2026-11-16 — Phase 2 Step 3c — reception patient screens (web)

- **Commit hash(es):** (uncommitted)
- **Added:** `/app/patients` search (UHID / phone / name, `?q=` prefill + single auto-run, paging, side-panel quick view); `/app/patients/new` and `/app/patients/[id]/edit` shared `PatientForm` (age-or-DOB select sends one value, six address fields, TEXT/NUMBER/DATE/DROPDOWN custom fields, inline duplicate panel with register-anyway); `/app/patients/[id]` record tabs; `/app/patients/[id]/slip` print view with `@page` size injected from `patientsWebConfig.slipPaperSize`; Settings UHID start-number card (GET/PUT through `/api/staff/patients/uhid/start-number`); `lib/patients/{client,format,payload}.ts` fetch/format/body helpers; print CSS (`.patient-slip`, `.patient-slip-print-root`, `.no-print`) and `--size-side-panel` / `--size-slip-max` tokens in `globals.css`
- **Changed:** settings page now renders the UHID card (`canWrite` from `hospital.settings.write`); `components/patients` added to `staff-ui-copy-scan` roots; four `auth-handlers.spec` upstream-error mocks now supply `text()` to match the size-capped body read in `api-client`; Prettier applied to staff route handlers and two plumbing specs
- **Removed:** placeholder empty states on the patients and settings pages
- **Fixed:** settings page referenced copy keys that no longer exist
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_STAFF_UPSTREAM_ERROR_BODY_MAX_BYTES`, `WEB_PATIENT_SEARCH_MIN_NAME_LENGTH`, `WEB_PATIENT_SEARCH_PAGE_SIZE`, `WEB_PATIENT_SEARCH_MAX_PAGE_SIZE`, `WEB_PATIENT_SLIP_PAPER_SIZE`
- **Tests:** 237 passing in `@hospigo/web` (was 155; plumbing + reception screens)
- **Decisions:** search limits and slip paper size are read on the server and passed to client components as props (non-`NEXT_PUBLIC` env is not in the browser bundle); upstream error text is never shown, only `staffCopy.errors.*`; edit sends only changed non-empty fields and skips PATCH when nothing changed; after PATCH `{ id }` the record page refetches via GET; print hides shell chrome (`.shell-root` siblings of the main column, top bar, `.no-print`)
- **Follow-ups and open items:** clearing a previously filled field on edit is not possible through the current PATCH contract; visits and bills tabs are placeholders

## 2026-11-16 — Phase 2 Step 3c Chunk 0a — UHID start-number GET + current-period PUT

- **Commit hash(es):** (uncommitted)
- **Added:** `GET /patients/uhid/start-number` (`hospital.settings.read`) — next number + preview, no writes
- **Changed:** `PUT /patients/uhid/start-number` raises the current period from the effective format (not always period 0)
- **Removed:** none
- **Fixed:** yearly hospitals could not raise the active FY counter via HTTP
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** UHID preview + FY boundary; registry GET route order/auth/isolation; PUT current period
- **Decisions:** none
- **Follow-ups and open items:** Step 3c reception patient screens

## 2026-11-16 — Phase 2 Step 3b — application frame polish (layout round 4)

- **Commit hash(es):** (uncommitted)
- **Added:** `--sidebar-mark-size` (`2.5rem`)
- **Changed:** sidebar floor `--sidebar-width` `13rem` → `13.5rem`; brand mark uses mark token (not touch size); wordmark never ellipsizes
- **Removed:** wordmark `text-overflow: ellipsis` / shrink
- **Fixed:** expanded “Hospigo” truncated to “Hosp…” beside mark + collapse
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** wordmark full text + nowrap; hospital keeps truncate/ellipsis class
- **Decisions:** none
- **Follow-ups and open items:** Step 3c patient search/register; Step 3d branch switcher

## 2026-11-16 — Phase 2 Step 3b — application frame polish (layout round 3)

- **Commit hash(es):** (uncommitted)
- **Added:** expanded sidebar hospital name on its own full-width ellipsis row with Tooltip; user-menu email Tooltip
- **Changed:** role badges share one flex-wrap row; frame sketch in `docs/design/ui-design.md`
- **Removed:** none
- **Fixed:** hospital name no longer truncated beside brand/wordmark/collapse on one row
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** shell-frame hospital row + collapsed hide; user-menu email tooltip + wrapping roles
- **Decisions:** email uses Tooltip + `tabIndex={0}` (not native `title`)
- **Follow-ups and open items:** Step 3c patient search/register; Step 3d branch switcher

## 2026-11-16 — Phase 2 Step 3b — application frame polish (layout round 2)

- **Commit hash(es):** (uncommitted)
- **Added:** collapsible sidebar mark/wordmark layout, Tooltip, Ctrl/Cmd+B, PoweredBy + branding hook, skip link, `--input-border`, page title template + per-route titles, user-menu redesign
- **Changed:** Settings is last main-nav item (permission-gated); collapse uses PanelLeft only; branch chip is a flat read-only label; inputs use white surface + stronger border
- **Removed:** separate Settings footer block; PanelLeftClose; bordered branch chip; native-title-only collapsed tooltips
- **Fixed:** clipped brand text / overlapping collapse control when sidebar collapsed
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** shell-frame polish (collapse mark, tooltip, shortcut, Settings last, PoweredBy, user menu, branch chip, skip, titles, input contrast)
- **Decisions:** branch switcher deferred to Step 3d (SuperAdmin only)
- **Follow-ups and open items:** Step 3c patient search/register; Step 3d branch switcher

## 2026-11-16 — Phase 2 Step 3b — application frame (layout round)

- **Commit hash(es):** (uncommitted)
- **Added:** global product theme on `:root`; collapsible sidebar; top-bar branch chip, patient search, user menu; Settings placeholder (`hospital.settings.read`); role label map
- **Changed:** IBM Plex Sans as sole app font; login/password/patient brand panels use sidebar navy + accent buttons; Sample data badge is a content-width pill; Patients empty title no longer repeats the page title
- **Removed:** `.theme-staff` scope; Geist font; sidebar branch/role block; Front desk / empty Setup labels; page title and standalone Sign out in the top bar
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** shell-frame specs (collapse, search, user menu, Settings visibility, role labels); existing suites updated for frame assertions
- **Decisions:** one visual identity for the whole product; branch switcher for SuperAdmin deferred to Step 3d
- **Follow-ups and open items:** Step 3c patient search/register UI; Step 3d SuperAdmin branch switcher

## 2026-11-16 — Phase 2 Step 3b — reception web foundation

- **Commit hash(es):** (uncommitted)
- **Added:** `/auth/me` `permissions[]`; web `callStaffApi` + `requirePermission`; scoped `.theme-staff` + IBM Plex Sans; UI kit; Patients placeholder page; `staff-copy.ts` + copy scan; `docs/design/ui-design.md`
- **Changed:** staff/HQ shell restyle (dark sidebar, nav groups); dashboard shows `no-permission` notice; postman folders untracked + gitignored
- **Removed:** tracked `.postman/` and `postman/` (left on disk)
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_STAFF_UPSTREAM_TIMEOUT_MS`, `WEB_ERROR_NO_PERMISSION`
- **Tests:** auth/me permissions HTTP; staff-api/guards/UI kit/copy-scan; existing web+API suites retained
- **Decisions:** theme scoped to `/app` and `/admin` only; login/patient pages unchanged; permissions list uses AccessService without module gate
- **Follow-ups and open items:** Step 3c reception patients search/register UI

## 2026-11-16 — Phase 2 Step 3a — counters, patient registry API, permission guard

- **Commit hash(es):** (uncommitted)
- **Added:** `number_series` + `token_counters`; `NumberSeriesService` / `TokenCounterService`; `@RequirePermission` / `@AuthenticatedOnly` + `PermissionGuard` (deny-by-default); patients HTTP API (form-config, search, detail, register, update, UHID start-number); `patients.registry.read/write`; DEMO_NORTH custom patient fields; `docs/reference/api-opd.md`
- **Changed:** `normalizePhoneIN` lives in `apps/api/src/common/phone.normalize.ts` (patient-auth re-exports); AuthenticatedOnly on `/auth/me`, `/auth/change-password`, `/patient/me`; isolation samples for new tables; seed role grants for registry permissions
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** `20261116100000_number_counters` — FORCE RLS; app SELECT/INSERT/UPDATE (no DELETE); hq/patient no grants; `patients_refuse_identity_update` trigger; search indexes already present (not recreated)
- **New .env keys (names only):** `PATIENT_SEARCH_MIN_NAME_LENGTH`
- **Tests:** counters (parallel, rollback, FY/NEVER, IST day, RLS); permission route-scan + guard; patient registry HTTP e2e; seed custom-field counts; prior suite retained
- **Decisions:** audit update stores `changedFields` only (no old/new PII); TokenCounterService name avoids JWT TokenService clash; counters never open their own transaction
- **Follow-ups and open items:** Step 3b reception web patients

## 2026-11-14 — Phase 2 Step 2 — OPD masters, settings and mock data

- **Commit hash(es):** (uncommitted)
- **Added:** 11 OPD tenant tables (doctor profiles/timings/leave, charge items + append-only prices, doctor fees, medicines, vitals fields, payment modes, opd_settings, number_series_settings); `OpdMastersModule` services (Price, DoctorAvailability, OpdSettings, number-series format); four `opd.*` permissions; Receptionist/Nurse/Doctor roles + mock staff in dev seed
- **Changed:** isolation catalog samples for new tables; engineering tracker Phase 2 step list; schema-opd “As built”
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** `20261114100000_opd_masters_and_settings`; FORCE RLS; app SELECT/INSERT/UPDATE (no DELETE) on masters; SELECT/INSERT only on price tables; append-only UPDATE/DELETE/TRUNCATE triggers on price tables; hq/patient no grants; reused `uhid_reset_rule` for series reset
- **New .env keys (names only):** none
- **Tests:** OPD isolation/privileges/constraints/services/permissions/seed; existing API suite retained
- **Decisions:** separate number-series format helper reusing UHID FY/pad helpers; `FINANCIAL_YEAR` ≡ design YEARLY; print_templates deferred; services only (no controllers)
- **Follow-ups and open items:** Step 3a counters + patient register API

## 2026-11-13 — Phase 1 Step 6e — patient web login (BFF)

- **Commit hash(es):** (uncommitted)
- **Added:** patient httpOnly cookies; `/api/patient-auth/*` BFF; `/patient/login` + `/patient` pages; `requirePatient`; patient upstream timeout; web + API tests
- **Changed:** patient API verify/refresh responses drop `mustChangePassword`; session config patient keys; refresh single-flight namespace `patient`
- **Removed:** `mustChangePassword` from patient token JSON
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_PATIENT_COOKIE_*`, `WEB_PATIENT_REFRESH_COOKIE_*`, `WEB_PATIENT_LOGIN_PATH`, `WEB_PATIENT_HOME_PATH`, `WEB_PATIENT_UPSTREAM_TIMEOUT_MS`, `WEB_PATIENT_OTP_CODE_LENGTH`, `WEB_PATIENT_*` UI copy
- **Tests:** web patient BFF/guards/login/home; API shape without mustChangePassword; existing suites retained
- **Decisions:** patient cookies path `/api/patient-auth` (no prefix overlap with staff `/api/auth`); tokens never in browser JSON
- **Follow-ups and open items:** hospital profile linking; book/[code] still mock OTP

## 2026-11-13 — Phase 1 Step 6c — patient OTP login API

- **Commit hash(es):** (uncommitted)
- **Added:** global `patient_accounts` / `patient_otp_challenges` / `patient_auth_sessions`; role `hospigo_patient`; `PatientPrismaService`; OTP request/verify/refresh/logout + `GET /patient/me`; `MessageProvider` + `DevMessageProvider`; phone normalize; Redis `otp:` limits
- **Changed:** `TokenService` / `RequestKind` / AuthGuard for `PATIENT`; TenantDb refuses PATIENT; create-roles + CI env for patient DB/JWT/OTP secrets
- **Removed:** none
- **Fixed:** atomic OTP attempt/consume via parameterized `$queryRaw`/`$executeRaw` (DB `now()`); request-otp invalidate+insert in one SQL statement; patient logout `@Public` + family revoke (refreshToken only)
- **Database (migrations, roles, RLS):** `20261113100000_patient_accounts_and_otp` — SIU to `hospigo_patient` only; REVOKE from app/hq/PUBLIC; no tenant RLS
- **New .env keys (names only):** `DATABASE_URL_PATIENT`, `HOSPIGO_PATIENT_PASSWORD`, `JWT_PATIENT_ACCESS_SECRET`, `OTP_HASH_SECRET`, `OTP_*`, `PATIENT_*_TOKEN_TTL_SEC`
- **Tests:** phone normalize; OTP HTTP e2e (incl. parallel wrong/correct verify races + public logout); role grants; token separation; Redis fail-closed; existing suite retained
- **Decisions:** direct OTP send (not BullMQ) — code never stored plaintext; queue would require putting code in job data or regenerating. Dev driver only; production refuses DevMessageProvider. Request-otp uses single-statement CTE (not Prisma `$transaction`) because TenantDb safety-net hard-forbids `$transaction` in feature modules.
- **Follow-ups and open items:** hospital patient record linking; real WhatsApp/SMS providers; BOOKING OTP purpose

## 2026-11-12 — Phase 1 Step 7 — hardening and exit demo

- **Commit hash(es):** (uncommitted)
- **Added:** `/auth/me` `branches` + `enabledModules` (hospital); web module mapping + `requireModule`; distinct DEMO_NORTH/SOUTH module sets; first-live seed guard + production `isTest` refuse; `docs/reference/env-reference.md`, `docs/engineering-tracker.md`, `docs/guides/staging-checklist.md`; auth/me shell HTTP tests; web modules/module-guard tests
- **Changed:** hospital shell reads real session (no mock branch label); CI `APP_URL` → throwaway `http://127.0.0.1:3001`; web production instrumentation also requires `API_INTERNAL_URL`
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** none (seed-only module subscription differences)
- **New .env keys (names only):** optional `WEB_ERROR_MODULE_UNAVAILABLE`
- **Tests:** API shell/me + seed guards; web mapping/guard/shell; prior isolation/auth suites retained
- **Decisions:** production demo detection uses `hospitals.isTest` only; module nav labels live in `config/modules.ts` not components
- **Follow-ups and open items:** backups/FTP, WebSocket auth, load tests, release runbook (see engineering-tracker)

## 2026-11-12 — Phase 1 Step 6b fix — Strict Mode hash token capture

- **Commit hash(es):** (uncommitted)
- **Added:** StrictMode page tests for reset/activate; activate page spec
- **Changed:** `takeActionTokenFromHash` idempotent module capture so a cleared `#t=` is not treated as missing
- **Removed:** none
- **Fixed:** first open of a valid email reset/activate link no longer shows invalid-link under React Strict Mode
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** StrictMode + missing/malformed hash + POST body token
- **Decisions:** first hash read wins in memory; never re-decide from an empty fragment on the same path
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6b part B — web activate / forgot / reset

- **Commit hash(es):** (uncommitted)
- **Added:** BFF `forgot-password`, `hq-forgot-password`, `reset-password`, `activate`; pages `/forgot-password`, `/reset-password`, `/activate`; login forgot link + `?notice=password-updated`; Referrer-Policy/Cache-Control headers; web tests + API activate weak-password coverage
- **Changed:** session config copy/paths for email flows; docs for web flow
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** optional `WEB_FORGOT_*` / `WEB_ERROR_INVALID_LINK` / `WEB_ERROR_PASSWORD_VALIDATION` / `WEB_PASSWORD_UPDATED_NOTICE*`
- **Tests:** web handler/page/headers/token-query-scan; API activate weak-password then reuse token
- **Decisions:** token only in `#t=` then memory + POST body; forgot BFF masks non-429 4xx as 202
- **Follow-ups and open items:** none for 6b B

## 2026-11-12 — Phase 1 Step 6b part A — email activation / reset API

- **Commit hash(es):** (uncommitted)
- **Added:** `auth_action_tokens` / `hq_auth_action_tokens`; mail module (nodemailer + BullMQ `mail` queue); `POST /auth/forgot-password`, `/auth/hq/forgot-password`, `/auth/reset-password`, `/auth/activate`; `send-activation` script
- **Changed:** SMTP_USER/PASSWORD optional; APP_URL + SMTP_SECURE in API env validation
- **Removed:** none
- **Fixed:** none
- **Database (migrations, roles, RLS):** `20261112150000_auth_action_tokens` — hospigo_app SELECT/INSERT/UPDATE on tenant table; hospigo_hq SELECT/INSERT/UPDATE on HQ table; mutual REVOKE
- **New .env keys (names only):** `APP_URL`, `SMTP_SECURE`; `AUTH_FORGOT_PASSWORD_MIN_RESPONSE_MS`, `AUTH_RESET_MAX_REQUESTS_PER_WINDOW`, `AUTH_RESET_REQUEST_WINDOW_MS`, `AUTH_MAIL_JOB_*`
- **Tests:** email token lifecycle / concurrency / forgot-password 202 uniformity / HQ reset / activation
- **Decisions:** job payload never holds tokens/emails; link secret only after `#`; invalid links share one generic 400
- **Follow-ups and open items:** Step 6b part B web screens for activate/reset

## 2026-11-12 — Phase 1 Step 6d fix-up 4 — redirect host uses APP_URL

- **Commit hash(es):** (uncommitted)
- **Added:** `appUrl()` helper; refresh `Location` built from `APP_URL` origin; refresh single-flight map on `globalThis`
- **Changed:** docs/`.env.example` note that APP_URL must match the browser origin
- **Removed:** none
- **Fixed:** refresh no longer redirects `127.0.0.1` sessions onto `localhost` (cookie host mismatch)
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** refresh Location origin follows APP_URL when request host is localhost; open-redirect still rejected
- **Decisions:** absolute redirects use APP_URL; relative `next/navigation` redirects stay relative
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6d fix-up 3 — change-password BFF errors

- **Commit hash(es):** (uncommitted)
- **Added:** BFF maps upstream 400→`VALIDATION`, 403→`FORBIDDEN`; safe one-line 500 logs; change-password form keeps fields on error
- **Changed:** bad/empty 2xx upstream body → 502 `UNAVAILABLE` (not uncaught 500)
- **Removed:** none
- **Fixed:** hospital change-password password-rule failures no longer surface as opaque web 500
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** optional `WEB_ERROR_CHANGE_PASSWORD_*` copy overrides
- **Tests:** VALIDATION/502/safe-log handler tests; form keeps fields for VALIDATION/INVALID_CREDENTIALS/RATE_LIMITED
- **Decisions:** never forward upstream arrays/stack traces; validation copy stays generic (no hardcoded min length in UI)
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6d fix-up 2 — health gate + forwarded headers

- **Commit hash(es):** (uncommitted)
- **Added:** `WEB_TRUST_FORWARDED_HEADERS` (default false); HQ session gate on `GET /api/health`
- **Changed:** `/api/health` returns only `{ status }`; client IP ignores spoofed XFF unless trust flag is true
- **Removed:** none
- **Fixed:** public `/api/health` no longer unauthenticated
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `WEB_TRUST_FORWARDED_HEADERS`
- **Tests:** health 401/403/HQ-minimal fields; trust-forwarded true/false IP tests
- **Decisions:** production proxy needs web trust flag + API `AUTH_TRUSTED_PROXY` hop count together
- **Follow-ups and open items:** none

## 2026-11-12 — Phase 1 Step 6d cleanup — no browser API URL

- **Commit hash(es):** (uncommitted)
- **Added:** BFF `GET /api/health`; `instrumentation.ts` production `APP_URL` gate; X-Forwarded-For forwarding test
- **Changed:** `StorageStatusCard` calls `/api/health` (same-origin); NEXT_PUBLIC scan covers `.env.example` + `jest.env.cjs` and secret-like / API URL names
- **Removed:** `apps/web/src/lib/api.ts`; `NEXT_PUBLIC_API_URL` from web `.env.example` and `jest.env.cjs`
- **Fixed:** none
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** web suite (was 41) + XFF + APP_URL startup + tighter NEXT_PUBLIC scan
- **Decisions:** browser must never know API URL; production fails at startup if `APP_URL` unset
- **Follow-ups and open items:** none

## 2026-11-11 — Phase 1 Step 6d — web staff authentication

- **Commit hash(es):** (uncommitted)
- **Added:** Next BFF auth routes (`/api/auth/*`), httpOnly session cookies, `getSession` / layout guards, real `/login` + `/change-password`, shell display name + Sign out; `apps/web/src/config/session.ts`; `API_INTERNAL_URL` in env examples; `create-hq-admin` npm script on `@hospigo/api`
- **Changed:** `/login` is live (no sample badge / Step 6 note); `/admin` and `/app` require session kind; docs for web auth flow and trusted-proxy note
- **Removed:** sample-only login copy
- **Fixed:** protected layouts always bounce missing access through `/api/auth/refresh` (refresh cookie path `/api/auth` is not sent on `/admin`/`/app`); single-flight cleanup timer `unref`’d; middleware overwrites client `x-pathname`
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `API_INTERNAL_URL`; optional `WEB_*` session overrides
- **Tests:** web suite 41 (auth handler/guard/middleware/form/NEXT_PUBLIC scan); refresh-path + x-pathname overwrite covered
- **Decisions:** tokens never reach browser JS; refresh cookie path `/api/auth`; single-flight refresh map; Origin check on auth POSTs
- **Follow-ups and open items:** patient login / OTP; replace mock page data with APIs

## 2026-11-11 — Phase 1 Step 6a-2 — auth endpoints

- **Commit hash(es):** (uncommitted)
- **Added:** `AuthController` / `AuthService` / DTOs; `AuthRedisService` (IP rate limit + account lockout, fail-closed); global `APP_GUARD` AuthGuard; helmet; `docs/reference/api-auth.md`; HTTP endpoint tests (login failures, lockout, rate limit, refresh reuse, forced change, guard, validation, audits)
- **Changed:** `AuthGuard` is global (deny by default); `@Public` on health + login/refresh/logout; ValidationPipe whitelist/forbidNonWhitelisted/transform; body size + trust-proxy from `auth.config.ts`; Swagger mounted only when `NODE_ENV !== 'production'`; dev seed adds one `must_change_password=true` user (`MC001`); architecture / folder-guide / ci docs
- **Removed:** none
- **Fixed:** change-password brute-force lockout (separate Redis `cpw:` keys); seed emails use hyphenated domains so `@IsEmail` accepts them; refresh/session coverage expanded
- **Database (migrations, roles, RLS):** none (reuses `auth_sessions` / `hq_auth_sessions` / `audit_logs`)
- **New .env keys (names only):** `AUTH_CHANGE_PASSWORD_TOKEN_TTL_SEC`, `AUTH_REQUEST_BODY_LIMIT_BYTES`, `AUTH_TRUSTED_PROXY`, `AUTH_IP_RATE_LIMIT_WINDOW_MS` (plus existing optional `AUTH_*` from 6a-1)
- **Tests:** auth endpoint suite + Redis fail-closed unit tests; keep prior suite green (was 135 before this step)
- **Decisions:** logout is `@Public` + refreshToken body (idempotent); Redis down → 503 on login/refresh; HQ events stay in Nest Logger (`audit_logs` requires `tenant_id`); CI Redis service already present from 6a-1 (`REDIS_URL=redis://127.0.0.1:6379`)
- **Follow-ups and open items:** email/OTP/patient login (6b/6c); WebSocket auth (gateway is currently unauthenticated); restrict `/health/details`

## 2026-11-11 — Phase 1 Step 6a-1 — auth foundation (no endpoints)

- **Commit hash(es):** (uncommitted)
- **Added:** auth module (`PasswordService`, `TokenService`, `AuthGuard`, `@Public` / `@TokenKinds`, login + membership helpers); `HqPrismaService` (`DATABASE_URL_HQ`); `BranchAccessLookup`; `auth.config.ts`; one-time `apps/api/scripts/create-hq-admin.ts`; migrations for branch access codes, lookup function, password flags, `auth_sessions` / `hq_auth_sessions`
- **Changed:** access codes live on branches (not hospitals); JWT env keys split into `JWT_HOSPITAL_ACCESS_SECRET` + `JWT_HQ_ACCESS_SECRET`; argon2 moved to API runtime deps; CI writes the two JWT secrets; README / architecture / folder-guide updated
- **Removed:** `hospitals.access_code`, `lookup_hospital_id_by_access_code`, `JWT_SECRET` from `.env.example` / CI / env validation
- **Fixed:** access JWT sign/verify pin HS256 only; refresh verification uses constant-time `timingSafeEqual`; removed unused `@nestjs/jwt` dependency
- **Database (migrations, roles, RLS):** `20261111190000_branch_access_code` (column + case-insensitive unique index; Main Branch backfill; other branches `dev-placeholder-<id>`); `20261111190100_lookup_branch_by_access_code`; `20261111190200_drop_hospital_access_code`; `20261111190300_user_password_flags`; `20261111190400_auth_sessions` (RLS on `auth_sessions`; grants: `hospigo_app` SIUD on `auth_sessions`; `hospigo_hq` SIU on `hq_users` + SIUD on `hq_auth_sessions` — no other HQ widen)
- **New .env keys (names only):** `JWT_HOSPITAL_ACCESS_SECRET`, `JWT_HQ_ACCESS_SECRET`; optional `AUTH_*` overrides listed in `.env.example`
- **Tests:** branch-code uniqueness; lookup active/unknown/inactive; auth_sessions RLS + HQ grant checks; PasswordService (incl. verifyRefreshSecret); TokenService (HS256 pin, reject none/HS384/wrong family); AuthGuard probe controller; membership login helper; auth config validation (plus existing suite kept green)
- **Decisions:** refresh format `h.<tenantId>.<sessionId>.<secret>` / `q.<sessionId>.<secret>` so hospital session lookup can set tenant context without a cross-tenant scan; AuthGuard not global until 6a-2; seed users set `must_change_password=false` for local demos only; TokenService uses `jsonwebtoken` with HS256 pinned; every refresh check must use `verifyRefreshSecret`
- **Follow-ups and open items:** 6a-2 login/refresh/logout endpoints; register AuthGuard globally when endpoints land; email/OTP/patient login later; local `.env` must replace `JWT_SECRET` with the two new JWT keys (not edited by this step)

## 2026-11-11 — Phase 1 Step 5b — four concept screens with fake data

- **Commit hash(es):** (uncommitted)
- **Added:** concept screens on `/login`, `/admin` (Hospitals), `/app/opd` (OPD queue), `/book/[code]`; Coming later stubs for other HQ and hospital nav items; `apps/web/src/mock` fake data; async mock loader + loading/empty/error states; `docs/design/ui-concepts.md`; fluid theme tokens (type, spacing, controls, containers) plus login/surface/status colour tokens
- **Changed:** HQ and hospital sidebars use Step 5b nav; staff/booking shells take brand colour from mock hospital config; folder guide lists mock and ui-concepts paths; login phone layout (slim brand bar, no scroll goal) and full-height split from layout breakpoint (~700px); booking full-viewport fluid card with two columns from the same breakpoint; sidebar current-page highlight and desktop page-context top bar; HQ hospitals stacked cards under table breakpoint; auto-fit stat grids; branch label Main Branch (sample); primary colour teal for concept screens; booking/page wrappers use min-height only with document scroll and top-aligned sections
- **Removed:** admin page dependency on the live `/health` Storage status card for this concept step; duplicate Sample data badge on the login brand panel; fixed-device Tailwind size classes from concept screens in favour of theme utility classes; patient-visible access code on `/book/[code]`
- **Fixed:** UI revision rounds 2–4 (contrast, Send OTP gating, fluid layout, clipped non-scrolling pages, stretch gaps between booking sections)
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** Jest render tests for login (one sample badge), hospitals (card+table markup, current nav), OPD queue (three status chip variants, current nav, branch label), booking (no access code, Send OTP disabled until filled, load states); theme hardcode scan; scroll-lock scan (min-height only on page wrappers); shell smoke tests updated
- **Decisions:** PDF is image-based so text description follows the Step 5b prompt plus listed corrections; Platform health remains Coming later while System health card on Hospitals uses Storage wording; concept look is sample-only and driven by CSS variables; layout breakpoint literals documented once beside `@theme` tokens because media queries cannot read variables; `overflow-x: clip` on shell/html instead of `hidden` so document scroll is not trapped; no API calls
- **Follow-ups and open items:** Step 6 real auth; replace mock folder with APIs; wire Onboard hospital, Call next patient, Send OTP

## 2026-11-06 — Phase 1 — CI starts the compiled API and checks /health

- **Commit hash(es):** (uncommitted)
- **Added:** CI step that starts `node apps/api/dist/main.js`, waits up to 30 seconds for `GET /health` to return `{"status":"ok"}`, then stops the process
- **Changed:** README and `docs/reference/ci.md` describe that check
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** local start of the compiled API against the developer `.env`, then `/health`, then the process was stopped
- **Decisions:** no new service container; Redis is already provided and is not contacted by the liveness route
- **Follow-ups and open items:** the compiled-API check runs after the API tests and before the web build and web test steps

## 2026-11-06 — Phase 1 Step 5a fix — cn helper and web CI

- **Commit hash(es):** (uncommitted)
- **Added:** direct `clsx` and `tailwind-merge` dependencies for the web `cn` helper
- **Changed:** CI `ci` job builds and tests `@hospigo/web` after the API tests
- **Removed:** direct `cn` npm dependency from `@hospigo/web`
- **Fixed:** `apps/web/src/lib/utils.ts` now merges class names with `clsx` and `tailwind-merge` instead of the `cn` package
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** web smoke tests and API suite re-run locally; `tsc --noEmit` and web build
- **Decisions:** `shadcn` stays in dependencies because `globals.css` imports `shadcn/tailwind.css`
- **Follow-ups and open items:** `shadcn` still depends on its own `cn` package; production audit findings from `shadcn` and existing Nest `multer` were not auto-fixed

## 2026-11-06 — Phase 1 Step 5a — web shell

- **Commit hash(es):** (uncommitted)
- **Added:** Next.js App Router shell in `apps/web` (login, Indigo HQ, hospital staff, public booking); shared loading, empty, and error states; API client; auth-guard stub; mock navigation; web smoke tests; optional API `CORS_ORIGIN`; root `.nvmrc` and `engines`
- **Changed:** `apps/web` is no longer a placeholder; README setup notes for the web app and `CORS_ORIGIN`
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `CORS_ORIGIN` (API, optional), `NEXT_PUBLIC_API_URL` (web)
- **Tests:** API CORS origin test; web Jest smoke tests for each route page and layout plus the three state components
- **Decisions:** Next.js 16.4.5 (supports Node 22.14); no Hospigo UI concepts file, so a neutral shadcn style; Jest for web tests because it is already the API runner; did not add `eslint-config-next` because it requires ESLint 9 and the repo stays on ESLint 8
- **Follow-ups and open items:** Step 6 replaces the auth-guard stub; remove `src/mock` when navigation comes from the API

## 2026-11-05 — Phase 1 — CI audit job uses npm ci --ignore-scripts

- **Commit hash(es):** (uncommitted)
- **Added:** nothing
- **Changed:** `audit` job install → `npm ci --ignore-scripts` (lockfile-only; skips prisma generate); `docs/reference/ci.md` notes why
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** lint + format:check only (Actions not run locally)
- **Decisions:** audit does not need install scripts; `ci` job unchanged
- **Follow-ups and open items:** none for this tweak

## 2026-11-04 — Phase 1 — CI (GitHub Actions) + PR template + Dependabot

- **Commit hash(es):** (uncommitted)
- **Added:** `.github/workflows/ci.yml` (lint, format:check, API build, create-roles against Postgres 16 + Redis 7 services, API tests; report-only audit job); `.github/dependabot.yml` (weekly npm + github-actions); `.github/pull_request_template.md`; `docs/reference/ci.md`
- **Changed:** README CI section + docs index; folder-guide entries for `docs/reference/ci.md` and `.github/`
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none (CI bootstraps ephemeral roles/DBs on the runner only)
- **New .env keys (names only):** none
- **Tests:** local `npm test -w @hospigo/api` after adding CI files (unverified count here); real Actions validation on first push
- **Decisions:** Node 22 in Actions (matches local/README; no `engines` field yet); `HUSKY=0` in CI; audit report-only; no `secrets` context; per-run hex passwords for app roles; fixed CI-only Postgres service superuser password; both `DATABASE_URL_TEST` and `DATABASE_URL_OWNER_TEST` target `hospigo_test`
- **Follow-ups and open items:** confirm first Actions run on push; optionally add `engines.node` later; consider failing audit on high once noise is under control

## 2026-11-04 — Phase 1 Step 4 follow-up — rebuild guards, safety-net split, access/leak gaps

- **Commit hash(es):** (uncommitted)
- **Added:** rebuild URL/host/`current_database`/`is_test` guards + unit tests; access tests for inactive permission/role/role_permission/assignment-branch and deactivated branch_modules; leak test for cross-hospital `created_by`
- **Changed:** safety-net — `PrismaService`/`set_config`/`$transaction` have no allowlist; only `$queryRaw`/`$executeRaw` are path-allowlisted
- **Removed:** nothing
- **Fixed:** rebuild could previously DROP based on URL text alone
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** 118 passing on `hospigo_test` (twice)
- **Decisions:** local-host-only rebuild; BRANCH membership rule retained
- **Follow-ups and open items:** none for this follow-up

## 2026-11-04 — Phase 1 Step 4 follow-up — BRANCH scope requires user_branches

- **Commit hash(es):** (uncommitted)
- **Added:** AccessService tests for assignment-without-membership, membership-without-assignment, both-required allow, deactivated membership deny
- **Changed:** BRANCH-scoped `AccessService` grants now require active `user_branches` membership for that branch; HOSPITAL scope unchanged (no membership required)
- **Removed:** nothing
- **Fixed:** BRANCH access could previously succeed from assignment alone without membership
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** none
- **Tests:** 105 passing on `hospigo_test` (twice)
- **Decisions:** membership is mandatory for BRANCH scope only
- **Follow-ups and open items:** none for this follow-up

## 2026-11-04 — Phase 1 Step 4 — Request context, TenantDb, AccessService, clean test DB

- **Commit hash(es):** `de40f04`, `decdbe3`, `2f1e366`
- **Added:** Jest globalSetup rebuild of `hospigo_test`; `RequestContext` ALS; `TenantDb` door; `AccessService`; safety-net scan; TenantDb / access / hospital-isolation leak tests
- **Changed:** Patients, UHID, field settings, ImportBatchService use TenantDb only; `PrismaService` no longer exported from `PrismaModule`
- **Removed:** manual `set_config` from feature services
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** none (no schema change)
- **New .env keys (names only):** none
- **Tests:** 101 passing on `hospigo_test` (twice in a row from clean rebuild)
- **Decisions:** schema-drop rebuild (not drop database) to preserve CONNECT hardening; AccessService does not require `user_branches` for BRANCH-scoped grants (schema allows assignment without membership)
- **Follow-ups and open items:** Step 5–6 controllers/tokens; optional service path to fail APPROVED import batches; patient cross-branch visibility undecided

## 2026-11-04 — Phase 1 Step 3b-2 follow-up — Import tests + concurrency fixes

- **Commit hash(es):** `108606b` (fix), `a9d777e` (test)
- **Added:** full 6×6 DB status matrix; NULL-branch duplicate cases; raw SQL exception CHECK cases; unmatched-row catalog snapshot; concurrent approve/post/undo/approve-vs-fail; `import_types` DELETE/TRUNCATE refuse
- **Changed:** `ImportBatchService` locks batch rows with `SELECT … FOR UPDATE`; `fail()` accepts DRAFT|PREVIEWED only (mutual exclusion vs approve)
- **Removed:** nothing
- **Fixed:** same-status status UPDATE no longer no-ops (trigger raises); approve-vs-fail race both succeeding when approve won first
- **Database (migrations, roles, RLS):** in-place edit of unpushed `20261104200000_import_batches` — status no-op refused
- **New .env keys (names only):** none
- **Tests:** 78 passing on `hospigo_test`
- **Decisions:** APPROVED→FAILED stays legal at DB; service `fail()` stops at PREVIEWED so concurrent approve/fail has one winner
- **Follow-ups and open items:** optional service path to fail an APPROVED (not yet posted) batch without weakening the race

## 2026-11-04 — Phase 1 Step 3b-2 — Import batch tables and bookkeeping

- **Commit hash(es):** `2069aa3`, `41dc354`, `d992aa2`, `f2d9309`
- **Added:** `import_types` (global), `import_batches` / `import_batch_rows` / `import_exceptions`; DB state machine + immutability triggers; `ImportBatchService` / `ImportsModule`; import Jest suite
- **Changed:** `GLOBAL_TABLES` allowlists `import_types`; isolation fixtures cover new tenant tables; architecture notes for import design and UHID counter follow-up after patient import
- **Removed:** nothing
- **Fixed:** nothing
- **Database (migrations, roles, RLS):** `20261104200000_import_batches` — app SELECT/INSERT/UPDATE only on tenant import tables; SELECT-only on `import_types`; no HQ grants
- **New .env keys (names only):** none
- **Tests:** 71 passing on `hospigo_test` (prior 64 + import suite)
- **Decisions:** import types are data not code; `raw_values` JSONB allowed only as immutable audit/undo copy; no Excel parsing in this step
- **Follow-ups and open items:** Excel parsers and domain handlers per import type; patient-import must call `setStartNumber` past max imported UHID; auth/controllers/UI later

## 2026-11-04 — Phase 1 Step 3b-1 follow-up — UHID format immutability + DB-level tests

- **Commit hash(es):** `497c089`, `2c4678d`, `64088e8`
- **Added:** `uhid.db-level.spec.ts` — deferred FY/RUNNING_NUMBER triggers, counter raise-only, true 50-connection concurrency, NEVER vs FY boundary, app privilege checks
- **Changed:** `hospigo_app` on `uhid_format_configs` / `uhid_format_blocks` is SELECT+INSERT only (policies split); revoked DELETE on patient customisation tables
- **Removed:** app UPDATE/DELETE grants and FOR ALL policies on UHID format tables
- **Fixed:** format-config immutability for the app role (privileges + policies)
- **Database (migrations, roles, RLS):** `20261104190000_lock_uhid_format_immutability`
- **New .env keys (names only):** none
- **Tests:** 64 passing on `hospigo_test`
- **Decisions:** no all-role UPDATE/DELETE trigger on format tables (would break owner deferred-trigger tests); app immutability via grants/policies only
- **Follow-ups and open items:** apply migrate deploy on any non-test DB that still points at a separate `DATABASE_URL_OWNER` host/db if used in other environments

## 2026-11-04 — Phase 1 Step 3b-1 — Patients, field settings, UHID engine

- **Commit hash(es):** `cde436e`, `9acfe98`, `23edf0c`, `8cf75ae`, `f095275` (+ docs hash follow-up)
- **Added:** Patients + `patient_identifiers` (table only); patient field catalog/settings/custom fields; UHID format configs/blocks/counters; `PatientsModule` services (`PatientsService`, `PatientFieldsService`, `UhidService`); injectable clock; hospigo_security column-privilege test; patients/UHID Jest suite
- **Changed:** `hospigo_security` hospital update narrowed to `UPDATE (id)`; `GLOBAL_TABLES` allowlists `patient_field_catalog`; isolation fixtures cover new tenant tables; architecture docs for UHID/field settings/Aadhaar pending
- **Removed:** nothing
- **Fixed:** nested Prisma creates omit inherited `tenant_id` (composite FK); tenant `set_config` kept inside transactions for pool safety
- **Database (migrations, roles, RLS):** `20261104180000_tighten_hospigo_security_hospital_update`, `20261104180100_patients_and_identifiers`, `20261104180200_patient_field_settings`, `20261104180300_uhid_engine` — new migrations only (3a untouched). Patients/UHID/clinical: no grants to `hospigo_hq`. FY reset without FY block rejected in service + deferred DB trigger.
- **New .env keys (names only):** `PATIENT_SEARCH_MAX_PAGE_SIZE`
- **Tests:** 48 passing on `hospigo_test` (prior 34 + new isolation/UHID/field/security coverage); later raised to 64 with DB-level suite
- **Decisions:** hospital-wide UHID counter (all branches); no hardcoding of hospital formats/field lists in app code; Aadhaar write/search deferred; consultant column deferred to visits; setStartNumber role check pending Step 6; new-hospital default field settings deferred to Phase 2 onboarding
- **Follow-ups and open items:** auth/controllers/UI (Step 6); Aadhaar storage rules with manager; Indigo-side UHID tools (Phase 2); ledger design still pending for OPD billing

---

## 2026-11-04 — Phase 1 Step 3a — Prisma schema, roles, RLS

- **Commit hash(es):** `4588800`, `a575da7`, `0f03692`, `02fd360`, `fb9bec9`, `4e0cba9`, plus this docs commit
- **Added:** Prisma 7 schema + init RLS migration; `scripts/db/create-roles.mjs`; reference + dev-only tenant seeds; `PrismaModule`/`PrismaService`; RLS/security Jest suite; `.gitattributes` (LF); `docs/reference/architecture.md`, `docs/reference/folder-guide.md`
- **Changed:** API env validation for owner DB URL; health e2e uses app URL against `hospigo_test` only; eslint/gitignore/prettier ignore generated client; `postinstall`/`prebuild`/`pretest` run `prisma generate`
- **Removed:** `docs/.gitkeep` (replaced by real docs)
- **Fixed:** SECURITY DEFINER ACL — `REVOKE`/`GRANT` after `OWNER TO` must run as `hospigo_security` (`SET ROLE`); global `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` for owner/security; `hq_create_first_superadmin` locks the hospital row (`FOR UPDATE`), refuses missing/non-ACTIVE hospitals, and is race-safe for concurrent first-SuperAdmin calls
- **Database (migrations, roles, RLS):** roles `hospigo_owner` (BYPASSRLS, migrate/seed only), `hospigo_app`, `hospigo_hq`, `hospigo_security` (NOLOGIN); DBs `hospigo` + `hospigo_test`; FORCE RLS on tenant tables; login + first-SuperAdmin SECURITY DEFINER helpers; `hospigo_security` UPDATE on `hospitals` + `EXECUTE` on `cuid_like` for first-SuperAdmin
- **New .env keys (names only):** `POSTGRES_SUPERUSER_URL`, `HOSPIGO_OWNER_PASSWORD`, `HOSPIGO_APP_PASSWORD`, `HOSPIGO_HQ_PASSWORD`, `DATABASE_URL_OWNER`, `DATABASE_URL_TEST`, `DATABASE_URL_OWNER_TEST`, `DATABASE_URL_HQ`, seed password keys
- **Tests:** 34 passed (health/storage + full-table tenant isolation, first-SuperAdmin active/inactive/SUSPENDED/race, HQ privilege allowlist, SECURITY DEFINER PUBLIC revoke)
- **Decisions:** Legacy role `hospigo` and DB `hospigo_dev` left untouched; owner never used by running API; do not expose Postgres publicly
- **Follow-ups and open items:** Auth / Step 4+

---

## 2026-11-04 — Phase 1 Step 2 — NestJS API skeleton, health, local-folder StorageService

- **Commit hash(es):** `0a6286b`
- **Added:** NestJS API under `apps/api` (`@hospigo/api`); Swagger at `/docs`; env validation; health module; local-folder `StorageService` (`STORAGE_SERVICE` token + `LocalFolderStorageDriver`); Jest unit + e2e health tests
- **Changed:** Root ESLint TypeScript support; `.env.example` for API/storage; README for storage and API scripts
- **Removed:** MinIO client dependency and MinIO health checker; all `MINIO_*` env keys
- **Fixed:** Queue health check against Redis; Redis URL guidance toward `127.0.0.1`
- **Database (migrations, roles, RLS):** none in this commit
- **New .env keys (names only):** `NODE_ENV`, `API_PORT`, `STORAGE_ROOT_PATH` (and MinIO keys removed)
- **Tests:** 12 tests — local storage driver (put/get/exists/delete, path traversal, absolute paths, tenant prefix, health ok/fail) and health e2e (`/health`, `/health/details`, `/docs`)
- **Decisions:** Object storage is an injectable `StorageService` (local folder now; S3-compatible later). `GET /health` stays liveness-only; `GET /health/details` checks `postgres`, `redis`, `storage`, `websocket`, `queue`
- **Follow-ups and open items:** Auth restriction for `/health/details` (Step 4); Prisma/RLS tenancy (Step 3a)

---

## 2026-10-26 — Phase 1 Step 1 — Monorepo skeleton

- **Commit hash(es):** `2e067a6`
- **Added:** npm workspaces root; placeholder packages `@hospigo/api`, `@hospigo/web`, `@hospigo/shared`; `tsconfig.base.json`; ESLint; Prettier; Husky pre-commit (`npm run lint`); `.env.example`; README; `.cursor/rules/hospigo.mdc`; `docs/.gitkeep`
- **Changed:** n/a (initial skeleton)
- **Removed:** n/a
- **Fixed:** n/a
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `APP_URL`, `API_URL`, `STAGING_URL`, `DATABASE_URL`, `REDIS_URL`, `MINIO_*` (later removed in Step 2), `SMTP_*`, `JWT_SECRET`
- **Tests:** none in this commit
- **Decisions:** Work on `develop`; `main` is default; public domains use `hospigo.indigocomputers.in`; never commit `.env`
- **Follow-ups and open items:** NestJS API skeleton (Step 2)
