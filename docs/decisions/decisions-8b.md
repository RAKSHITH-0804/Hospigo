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
