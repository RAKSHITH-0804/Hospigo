# Decisions, Step 8b (masters setup: starting a real hospital)

Branch: `feature/step-8b-masters-setup`, from `develop` at `4fc440a` (Step 8a merged). One branch, one PR. Decisions by Rakshith, 23 Nov 2026, with the reasons.

## Decisions

1. **Option A: parts A, B, C and D in one PR.** Build order: A (starter script), B (price change), C (Excel upload), D (doctor availability, timings and leave). **Part D was the cut line (it was built after the first report, see the Part D section):** if it clearly cannot finish, A, B and C are completed with docs and tests, D goes to a separate local branch, and the report says so. _Why:_ Wed and Thu are the days planned for 8b and Step 9 starts Friday; A, B and C are what a hospital needs to start billing, D is useful but not blocking.
2. **No undo for imports after posting.** A batch can be CANCELLED before it is posted (nothing is saved). After posting, a correction is a new upload: medicines and tests update by code, prices get a new version and are never deleted. **This is a deviation from the 4 Nov rule** in `docs/project-context.md` ("preview, approve, post, undo the whole batch"). _Why:_ price rows are append-only (a database trigger refuses update and delete, and the money rules say prices are never edited or deleted), so a posted price batch cannot be taken back; offering undo for some types and not others would be confusing, so the posted state is final for every type. The engine's UNDONE state and its undo method stay in the code unused by the screens; they are not exposed by any route.
3. **Price effective date:** not before today in hospital time (the OPD rules timezone), except the very first price of an item. _Why:_ a price dated in the past would silently change what new bills charge from "now" and would make a later correction impossible (a new price may not be earlier than the latest one).
4. **Hospital creation stays manual** (HQ creating a hospital is parked). The runbook is `docs/guides/new-hospital-runbook.md`. "HQ hospital creation" is added to the go-live blockers of the exit report (Step 9).
5. **(Superseded 24 Nov: 8c now comes BEFORE Step 9, see `decisions-8c.md`.) Step 8c is NOT in this step** (number-series settings screen, payment mode and vitals field editing, base fee plus follow-up override, voided-token marker, queue doctor filter, patient reference fields, per-branch print templates, extra print values). **8c moves AFTER Step 9** unless 8b finishes early. Nothing in 8b makes 8c harder: the starter script writes the same rows the future screens will edit, and never overwrites a value an Admin changed.
6. **Not in 8b:** a hospital creation tool, staff or doctor Excel upload (Step 7d covers staff), part payment, the dues list, the Emergency flag (deferred to the manager), online booking.

## What exists today (checked in the code on 23 Nov 2026)

- `opd.masters.write` and `opd.prices.write` exist as permissions; no controller used them. `PriceService.addChargeItemPrice` and `addDoctorFee` were services only.
- The import engine (`ImportBatchService`) is bookkeeping only: batch states (DRAFT, PREVIEWED, APPROVED, POSTED, UNDONE, FAILED), 3 tables, no upload route, no Excel reading, no templates, no apply code, and no import types seeded.
- Prices are append-only (database trigger); a new price must not be earlier than the latest.
- `doctor_timings` and `doctor_leave`: the application login has SELECT, INSERT and UPDATE only (no DELETE).
- A hospital without the starter data gets `409 NUMBER_SERIES_NOT_CONFIGURED` on its first visit. A hospital without a UHID format cannot register patients ("No UHID format config effective for this hospital; registration refused"). Only the dev seed wrote these rows.

## Notes added while building

(See the sections below as each part is finished.)

## Part A: starter script (built)

`npm run hospital:starter -w @hospigo/api -- --hospital CODE [--dry-run]` (code: `apps/api/src/database/hospital-starter/`, CLI `apps/api/scripts/hospital-starter.ts`). It creates only what is missing (payment modes Cash/Card/UPI, the 7 standard vitals, BILL/RECEIPT/REFUND number series, OPD rules, the Registration item with NO price, a default UHID format if none) and never overwrites a value an Admin changed. Idempotent: a second run reports "kept". `--dry-run` prints what it would do and writes nothing. No demo data. It writes one audit row (`hospital.starter.run`). It prints the database name only, never a connection string. Proof: a test shows a brand-new hospital completes a first visit only after the starter, a registration price and a doctor fee.

## Part B: price change (built)

Routes `GET /opd/prices`, `GET /opd/prices/history`, `POST /opd/prices/items/:id`, `POST /opd/prices/doctor-fees`, permission `opd.prices.write`. A new price is a new version (never an edit). The same amount again changes nothing (`changed: false`). Date rule: today or later, in the hospital time zone, except the very first price of an item; **at most 366 days ahead** (added in self-review: a date years ahead would become the latest version and block every later change, and versions can never be deleted). A price dated today starts "now"; a later date starts at the start of that day. Row locks serialise two changes at once. Audit stores ids and amounts only. Screen: Settings, OPD, Prices.

## Part C: Excel upload (built)

Lists: TESTS (code, name, price, optional start date, optional Active), DOCTOR_FEES (doctor code, visit type NEW/FOLLOW_UP, amount, optional date; both types required per doctor), MEDICINES (code, name, composition, form, active). Flow: upload (file judged by its bytes, background read with visible status) -> preview (exceptions with plain row reasons) -> approve -> post -> done; cancel any time before posting. Posting re-reads the stored file, checks its sha256, re-validates, and is **all or nothing** in one transaction (120 s limit instead of the default 5 s); if any row that was valid is no longer valid the whole post stops (batch stays APPROVED, can be tried again). Posting twice or twice at once saves once. Same file refused while a batch of it is active. Limits: 2 MB, 5000 rows, 30 columns, 25 MB unpacked, 100 zip parts. Refused: macros, external links, embedded objects, encrypted files, formulas. Text starting with = + - @ is kept as plain text. Screen: Settings, OPD, Upload lists.

## Choices I made that were not in the task

- Cancel is stored as state FAILED with run status CANCELLED (no new state, no migration).
- The TESTS list has an optional Active column (Active = No switches a test off by code; it never deletes and never touches prices).
- Price permission for a Branch Admin is hospital-wide (prices belong to the hospital, not a branch).
- Import types (TESTS, DOCTOR_FEES, MEDICINES) are written by the reference seed: an existing dev database needs `npm run prisma:seed -w @hospigo/api` once.
- A late background run can never overwrite a cancel (guarded status updates).

## Self-review (adversarial pass before the report)

Tried: wrong hospital (another hospital's batch, doctor, same file) -> refused, covered; replay and double post -> saves once, covered; two posts at the same moment -> covered; data changed after preview -> whole post refused, covered; file swapped on disk after approve -> refused, covered; formula, macro, zip bomb, wrong type -> refused, covered; missing permission and no token on every route -> covered; huge file -> **found: the default 5 s transaction would fail a big post; fixed** (120 s) and proven with an 800-row test; far-future price date -> **found: it would lock the item forever; fixed** (366 days). Not covered: a real crash of the server in the middle of a post (the transaction rolls back by the database's own rule; a stale run is marked failed after 10 minutes). Orphan files: a cancelled or failed upload keeps its stored file (follow-up, small). Verdict: safe to approve.

## Part D: doctor availability, timings and leave (built after the first 8b report, on the same branch)

**Why and when:** the first 8b report (commit `155696d`) said Part D was cut. After that report Rakshith allowed the time (23 Nov 2026: 8b had finished early), so Part D was built **on the same branch `feature/step-8b-masters-setup`**, on top of `155696d`, and goes into the ONE PR for the whole of 8b (A, B, C, D). No new branch was made.

**Before building I checked the default:** a new doctor profile is written by the staff service (Step 7d) with no availability value, and the column `availability_on` has `DEFAULT true` (migration `20261114100000`, schema `@default(true)`), so a new doctor is available at once and can be picked in a brand-new hospital. Nothing needed fixing. A test now proves it (a profile created exactly as the staff service does shows `availabilityOn true`, and reception can pick the doctor).

**Migration** `20261127090000_doctor_availability_delete_grant` (named after `20261126092000`; applied to `hospigo_test` only):

```sql
GRANT DELETE ON TABLE doctor_timings, doctor_leave TO hospigo_app;
```

No other table, no other login. Both tables stay under forced row level security (policies `doctor_timings_app_all` and `doctor_leave_app_all` are FOR ALL with the tenant filter), so a delete can only reach rows of the signed-in hospital. The schema has no "active" column on these tables, so deactivating instead of deleting was not possible; the grant was the safe choice. A test checks the two grants and that doctor_profiles, doctor_fees, charge_item_prices, audit_logs, opd_visits and bills still refuse DELETE for the application login.

**API** (`apps/api/src/modules/doctor-availability/`), all under `/opd/doctors/:id/availability`:

| Route                        | Permission          | What                                                                              |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `GET`                        | `opd.doctors.read`  | switch, branches the caller may see, weekly times of those branches, leave, today |
| `PUT switch`                 | `opd.doctors.write` | on or off (a real boolean)                                                        |
| `PUT timings/:branchId`      | `opd.doctors.write` | replaces the whole weekly timetable of that doctor in that branch (empty clears)  |
| `POST leave`                 | `opd.doctors.write` | adds a leave period (first and last day)                                          |
| `POST leave/:leaveId/remove` | `opd.doctors.write` | removes a leave period                                                            |

No new permission: the existing doctor permissions are used, so no seed change is needed. A hospital-wide Admin (SuperAdmin) reaches every doctor. A Branch Admin reaches only doctors who work in a branch where they hold the permission (a doctor outside is 404) and may change the weekly times of those branches only (another branch is refused with `BRANCH_NOT_ALLOWED`; a branch of another hospital or one the doctor does not work in gets the same answer).

**Rules:** times are `HH:MM`, the end must be after the start, touching slots are fine, overlaps are refused, at most 4 slots per weekday. Leave: both days real dates, end not before start, not ended before today, at most 366 days long, starting at most 731 days ahead, no overlap with another leave of the same doctor, at most 200 periods. Leave blocks assignment on its days only (the last day counts) and the switch blocks it until switched on again; timings only warn (`outsideTimings`), as already decided and implemented in `DoctorAvailabilityService`, which was not changed. Each change takes a row lock on the doctor profile, so two requests at once run one after the other (proven: three equal leave requests save once; three timetable saves leave one whole timetable).

**Audit** (`DOCTOR_AVAILABILITY_CHANGE`, entity `doctor_profiles`): kind and ids, dates, times only (`SWITCH` with the boolean, `TIMINGS` with branch id and slots, `LEAVE_ADD` and `LEAVE_REMOVE` with leave id and dates). No typed text; the reason is a fixed sentence.

**Decision (safest reading, noted):** the switch and leave belong to the doctor, not to a branch. A Branch Admin may therefore switch off or add leave for a doctor who also works in another branch, and that applies in both branches. The alternative (hospital-wide Admin only) would leave a branch without any way to record the leave of its doctor. Only the weekly times are per branch. Revisit if a hospital objects.

**Web:** an **Availability** button on every doctor in Settings, Doctors (also for a reader, who sees but cannot change) opens a panel with the switch, the weekly times per branch (day, from, to, add and remove rows, one Save per branch) and the leave list with an add form (two calendars). Loading line, retry on error, empty states, plain reasons for every refusal, double-click safe. A mistake in times is shown before anything is sent (the API still decides). All text is in the copy file.

**After Rakshith's first manual test (23 Nov):** the price form now lines the amount and the start date up at the top (`cluster-top`); the Availability panel is a **pop-up dialog** (new reusable `Modal`: Escape, Close button, click outside, focus kept inside and returned) with the switch and leave on one side and the weekly times on the other; the sample Excel files leave optional cells truly empty (no empty text runs); the 8b Postman collection sent no query string (generator fixed). The full manual test of **Upload lists** and **Doctor availability** is NOT done and is on the go-live checklist (handoff, CURRENT STATE).

**After the second manual test (23 Nov):** staff and roles use Activate and Deactivate (instead of Switch on and off); the Add staff fields line up at the top; the confusing All branches tick under a role is replaced by a clear section Where each role applies (only the branches ticked, or every branch; hospital-wide Admin only); the Upload preview shows every column of the file and Open on a saved upload shows the rows that were saved and scrolls to them; the upload form lines up on the bottom edge; the Availability pop-up is one narrow portrait column (switch, weekly times, leave) and its doctor switch says Make available or Make unavailable.

**After the third manual test (23 Nov):** the Edit forms of the Doctors page and of the Roles page open as pop-up dialogs (like Availability); each doctor has a **Fees** link that opens Prices already searched for that doctor (the page now reads `kind` and `q` from the address); the Availability pop-up has a short **What to do here** guide, a **Monday to Friday** quick fill for a full-time doctor, an Add leave button in line with the date fields, and a clear overlap message that names the day and the two times (an old error also disappears as soon as a time is changed; the overlap shown in the test was a leftover message, the two times themselves did not overlap); the permission groups of a role no longer stretch into tall empty boxes. **Roles are still never deleted, only deactivated** (decision of Step 7d): a role that people hold shows why it cannot be deactivated. Open question for Rakshith: allow a real delete of a role nobody ever held? That needs a migration (DELETE grant), so it was not done. **Doctor leave requests with admin approval** is planned in `docs/plans/plan-doctor-leave-requests.md` and is **moved to Step 8c** (decided 23 Nov). **At the end of Phase 2 everything must be tested again by hand** (Rakshith, 23 Nov): put a full manual checklist in the Step 9 plan.

**Not in Part D:** public booking slots and appointment lengths (online booking is still deferred), exceptions for one single date, a calendar overview of all doctors.

**Self-review (Part D):** tried: reception and a user with no permission on every route (403), no token (401), another hospital's doctor, leave id and branch id (404 or `BRANCH_NOT_ALLOWED`), a Branch Admin on the doctor of the other branch (404) and on the timetable of the other branch (refused), overlaps, end before start, bad times and weekdays, extra fields, 5 slots on a day, text instead of a boolean, leave in the past, too long, too far, overlapping, a leave of another doctor removed through this address, removing twice, three requests at once. Found and fixed in my own tests only (an audit assertion that read an older row). Not covered: a real crash in the middle of a request (the transaction rolls back). Verdict: safe to approve.

**Observed, not changed (pre-existing):** the application login already had DELETE on `users` before this step (granted earlier, outside Part D). Worth a look in Step 9; the app never deletes users and foreign keys block it.
