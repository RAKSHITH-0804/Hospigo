# Decisions, Step 8b (masters setup: starting a real hospital)

Branch: `feature/step-8b-masters-setup`, from `develop` at `4fc440a` (Step 8a merged). One branch, one PR. Decisions by Rakshith, 23 Nov 2026, with the reasons.

## Decisions

1. **Option A: parts A, B, C and D in one PR.** Build order: A (starter script), B (price change), C (Excel upload), D (doctor availability, timings and leave). **Part D is the cut line:** if it clearly cannot finish, A, B and C are completed with docs and tests, D goes to a separate local branch, and the report says so. _Why:_ Wed and Thu are the days planned for 8b and Step 9 starts Friday; A, B and C are what a hospital needs to start billing, D is useful but not blocking.
2. **No undo for imports after posting.** A batch can be CANCELLED before it is posted (nothing is saved). After posting, a correction is a new upload: medicines and tests update by code, prices get a new version and are never deleted. **This is a deviation from the 4 Nov rule** in `docs/project-context.md` ("preview, approve, post, undo the whole batch"). _Why:_ price rows are append-only (a database trigger refuses update and delete, and the money rules say prices are never edited or deleted), so a posted price batch cannot be taken back; offering undo for some types and not others would be confusing, so the posted state is final for every type. The engine's UNDONE state and its undo method stay in the code unused by the screens; they are not exposed by any route.
3. **Price effective date:** not before today in hospital time (the OPD rules timezone), except the very first price of an item. _Why:_ a price dated in the past would silently change what new bills charge from "now" and would make a later correction impossible (a new price may not be earlier than the latest one).
4. **Hospital creation stays manual** (HQ creating a hospital is parked). The runbook is `docs/guides/new-hospital-runbook.md`. "HQ hospital creation" is added to the go-live blockers of the exit report (Step 9).
5. **Step 8c is NOT in this step** (number-series settings screen, payment mode and vitals field editing, base fee plus follow-up override, voided-token marker, queue doctor filter, patient reference fields, per-branch print templates, extra print values). **8c moves AFTER Step 9** unless 8b finishes early. Nothing in 8b makes 8c harder: the starter script writes the same rows the future screens will edit, and never overwrites a value an Admin changed.
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

## Part D: doctor availability, timings and leave (NOT built: the cut line)

Not started, by decision 1. Impact today: no screen sets the availability switch, a weekly timetable or leave; nothing edits `availabilityOn`, so doctors stay as the seed or the owner left them. Design for later: migration named after `20261126092000` giving the application login DELETE only on `doctor_timings` and `doctor_leave` (the only grants, nothing else); API under `/opd/doctors/:id/availability`; a panel on the Settings, Doctors page. Leave days keep the decided rule (they block assignment). No migration was created in 8b.
