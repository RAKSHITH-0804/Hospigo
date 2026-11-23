# Decisions, Step 7f (fixes from the Phase 2 audit)

Branch: `feature/step-7f-audit-fixes` (built on the docs branch `docs/phase2-step-7-merged`, so the audit and the 7 to 7e docs travel in the same pull request). Built 23 Nov 2026. Source of truth for what to fix: `docs/audit/phase2-audit.md`. Only the items listed for 7f were fixed.

## What was built

| #   | Item                                                                                                                                                                                                                                                                                                                                                              | Where                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | The UI-text scan test now scans EVERY folder under `apps/web/src` (a new folder is covered automatically). Login, forgot, reset, activate, change-password, admin and the shared Retry button read their text from `staffCopy` (`auth`, `admin`, `states`).                                                                                                       | `config/staff-ui-copy-scan.spec.ts`, `config/staff-copy.ts`                            |
| 2   | `/book/[code]` is a "Coming soon" page (text from the copy file, no hospital name, no access code, no sample doctors). The mock booking screen and `mock/booking.ts` were removed. `/admin` keeps its "Sample" badge (checked by test).                                                                                                                           | `components/book/booking-coming-soon.tsx`                                              |
| 3   | **Registration fee after a cancelled first visit.** A database trigger voids the fee when the visit that carried it is cancelled AND its bill was refunded in full. Migration `20261126090000_registration_fee_void_on_cancel`.                                                                                                                                   | migration, `database/registration-fee-void.spec.ts`                                    |
| 4   | DELETE and TRUNCATE blocking triggers (they fire for the owner role too) on `stored_images` and `uhid_counters`; the raise-only UPDATE of `uhid_counters` still works. Migration `20261126091000_image_and_uhid_counter_protection`.                                                                                                                              | migration, `database/image-uhid-protection.spec.ts`                                    |
| 5   | Duplicate-patient warning (UC02-7) needs the same mobile, the same name AND the same date of birth. `confirmDuplicate` must be a real boolean: the text "false", "true" or "1" is refused with 400.                                                                                                                                                               | `patients.service.ts`, `dto/register-patient.dto.ts`                                   |
| 6   | Registration slip field **relative**: the values of the patient's custom fields whose field definition is in section RELATIVE, in sort order, joined with a space (for example "S/O Ravi Kumar"). Relation and name stay stored apart. The seed was not touched.                                                                                                  | `lib/patients/relative.ts`, `lib/print/documents.ts`, `PRINT_FIELDS.REGISTRATION_SLIP` |
| 7   | The token is mandatory on every RECEIPT template (built-in and custom, any layout version, even a switched-off template). A template without a token box is refused: `400 PRINT_TEMPLATE_INVALID { field: layout.elements, reason: TOKEN_REQUIRED }`, shown in plain words ("must show the token number on a receipt. Add the Token value to one of the boxes."). | `print-template.rules.ts`, `config/staff-copy.ts`                                      |
| 8   | Checked only, nothing changed: see "Item 8" below.                                                                                                                                                                                                                                                                                                                |                                                                                        |

## Item 3: the rule in detail (money)

- **Why not always void on cancel?** The cancel flow does NOT always refund the whole bill. A cancellation request may carry a zero or partial amount (`amountPaise` is optional and can be lower than the refundable amount). Voiding the fee while it was not given back would charge the patient twice.
- **Rule:** when a visit becomes CANCELLED, the registration fee record charged on THAT visit's bill is voided only if `bills.refunded_paise >= bills.total_paise` for that bill. A refund is per bill, not per line, so "the registration line was refunded in full" can only be proven by "the whole bill was refunded". A partial refund, or a zero cancellation, keeps the fee.
- **Timing:** a deferred constraint trigger (checked at COMMIT), so every refund of the request exists and the ledger has recalculated the bill, whatever the order of the statements.
- **Voided time:** the fee uses `opd_visits.cancelled_at`. The existing CHECK `opd_visits_cancelled_chk` already forces `cancelled_at` to be set in the same update that sets CANCELLED; the trigger also refuses a cancelled visit without it.
- **No new right for the application login.** The trigger is `SECURITY DEFINER` and calls `opd_assert_tenant`, the same pattern as the ledger.
- **Update guard:** `patient_registration_fees_guard_update` freezes every column except `voided_at` (`id`, `tenant_id`, `patient_id`, `bill_line_id`, `charged_at`); `voided_at` moves only from NULL to a time, never back, never twice. It applies to the owner role too.
- **No backfill.** Dev data on 23 Nov 2026 (read-only count on the dev database): 2 cancelled visits, both with a still-active registration fee. They are NOT changed; the owner can void them by hand if wanted.
- **Self-review (adversarial pass), what the tests cover:** a replayed cancel (refused, fee unchanged); two cancels at the same moment (exactly one wins, the fee is voided once, refunds are not doubled); a cancel asked from another branch (refused, fee stays); hospital B cannot cancel or void anything of hospital A, and the trigger itself refuses a trusted login that carries another tenant; the application login cannot UPDATE the table; the owner cannot change another column, un-void or re-void; cancelling a visit that did not carry the fee leaves the patient's fee alone; a partial or zero refund keeps the fee and a second active fee is still impossible. Not covered: a refund spread over several requests on one bill (`refunded_paise` adds them up, so the rule still holds, but there is no dedicated test).

## Item 3, follow-up: refunds made AFTER the cancel

- **Question:** can a refund still be made on the bill of an already-cancelled visit? **Yes.** The consultation never started, the API and the database only refuse a refund once `consultation_started_at` is set, and a partial refund at cancel time leaves money on the bill. Several refund requests can also add up over time.
- **So the cancel-time trigger was not enough:** a fee kept after a partial refund must be voided when later refunds bring the bill to the total. Migration `20261126092000_registration_fee_void_on_later_refund` adds a deferred constraint trigger on `refunds` (after insert): when the bill's `refunded_paise >= total_paise` AND the visit is CANCELLED, the registration fee of that bill is voided (time = the refund time). A full refund on a visit that is not cancelled keeps the fee; cancelling it afterwards voids it (the cancel-time trigger).
- **Safety:** `SECURITY DEFINER` with `opd_assert_tenant`, no new right for the application login, only an active fee is touched (so repeated firing is harmless), and the update guard of `patient_registration_fees` still allows nothing but voiding once.
- **Tests (`registration-fee-void.spec.ts`):** a later refund is possible; cancel partially then refund the rest voids the fee and the next visit is charged again; several refunds adding up (one paisa short does not void, the last one does); an over-refund is refused and the fee stays; a replay (same request key, a refund after the total) changes nothing; a full refund on a visit that is not cancelled keeps the fee until it is cancelled; two refunds at the same moment never exceed the bill; hospital B cannot insert a refund on hospital A.

## Item 4

`stored_images` and `uhid_counters` were protected from deletion only by a missing DELETE grant. The owner role (BYPASSRLS) could delete. Now BEFORE DELETE (row) and BEFORE TRUNCATE (statement) triggers refuse for every login, reusing `refuse_opd_price_mutation` and `refuse_opd_price_truncate`. The 3a "raise-only" trigger and the 7e `is_current` guard are unchanged. A hospital can therefore no longer be deleted through the cascade while it has pictures or a UHID counter (there is no such feature; a migration or owner script that needs it must disable the trigger on purpose).

## Item 5 notes

- The duplicate check runs only when a mobile and a date of birth exist after conversion (age is converted to an estimated date of birth first; the mobile and date of birth are always required fields). Another date of birth is not a possible duplicate.
- `confirmDuplicate` keeps its raw value (`@Transform` takes it from the request body before the implicit conversion), so `@IsBoolean` sees the real type.

## Item 6 notes

- Option (a) was chosen by Rakshith: print every value of the RELATIVE section in sort order. The dev seed also puts **title** (Mr, Mrs) in that section, so the demo slip prints "Mr S/O Name". The seed was not touched. A hospital controls what sits in the section.
- The new field is added to the field list of the registration slip. Templates saved before 7f do not have a box for it: an Admin adds the **Relative** value to the slip in the print designer. Built-in starting points include it (it prints only when the patient has a value).
- The older simple slip (used when no template is enabled) prints a "Relative" row too.

## Item 7 notes

- Tests that exercise other template rules with a RECEIPT now go through a small test wrapper that adds a tiny token box when the template was otherwise valid; the strict function is tested in its own section ("the token is mandatory on a receipt"). A few tests that built zero-box or 40-box RECEIPTs were moved to the registration slip or got a token box.

## Item 8: HQ and the UHID counter (checked, not built)

`PUT /patients/uhid/start-number` needs `hospital.settings.write` and a HOSPITAL token (`hospitalAuth`); an HQ token gets 401, and the `hospigo_hq` database role has no rights on the UHID tables. So only a hospital user with that permission (SuperAdmin and Branch Admin) can raise the counter. No HQ access was built (it would be a tenant-isolation review gate). Rakshith will confirm the wording separately.

## Decisions recorded from the audit (Rakshith, 22 and 23 Nov 2026)

1. **SuperAdmin reads the OPD queue, vitals and clinical notes.** Approved at Step 7 ("SuperAdmin sees everything"); the older decisions-4a text (Q6, notes only for Doctor and Nurse) is amended there.
2. **Doctor leave BLOCKS assignment; timings only WARN.** The code and its test already did this; UC-15.3 now says so.
3. **Repeat visit free:** `opd_settings.repeat_visit_free_hours` (same patient, same doctor, consultation fee 0 inside the window) was **approved by Rakshith on 22 Nov 2026**.
4. **Raising the UHID counter:** a hospital-wide Admin (Branch Admin and SuperAdmin) may raise it. This replaces the older "SuperAdmin only" rule (the code comment in `uhid.service.ts` is stale).
5. **Patient-update audit stores field names only**, never personal values.
6. **Vitals ranges only warn** (they do not refuse a value).
7. **Tax switched on stays `501 TAX_NOT_SUPPORTED`** (billing refuses rather than bill without tax).
8. **Registration fee is charged again after a cancelled first visit** (schema-opd open item 2), voided only when the cancelled visit's bill was refunded in full (above).

## DEFERRED, pending the manager's decision (to ask on demo day)

These are NOT built and NOT in 7f. The exit report (Step 9) and the handoff must say so.

- **Part payment, the pending-dues list and balance collection (UC-16).** Today the API takes exactly the bill total (split payment across modes is built).
- **The Emergency flag** (and Emergency visits in the doctor queue).
- **Whether online booking and doctor slots are in release 1** (`/book/[code]` is "Coming soon").

## Step 8c (new, scope only; not planned in detail)

Setup and masters that only the dev seed writes today:

1. Settings for the BILL, RECEIPT and REFUND number series (dev seed only today; a new hospital gets `409 NUMBER_SERIES_NOT_CONFIGURED`).
2. Edit screens for payment modes and vitals fields.
3. Doctor fee structure: a base fee plus an optional follow-up override, instead of two required rows.
4. A voided marker for the token of a cancelled visit, and cancelling visits other than WAITING if needed.
5. A doctor filter on the OPD queue.
6. Built-in patient reference fields (referred by, category, organisation, staff number) or a ready-made field set.
7. Per-branch print templates.

**Step 8b notes:** the starter script creates NO demo data; the Excel doctor fees must carry both NEW and FOLLOW_UP rows.

## Not done (follow-ups noticed, not fixed)

- (Fixed in the 7f follow-up: the stale comment in `uhid.service.ts`.)
- Existing hospitals' saved slip templates have no "Relative" box until an Admin adds it.
- The two cancelled dev visits with an active registration fee (counted, not changed).
- A DB test for a refund spread over several requests on one bill (the rule holds by `refunded_paise`, no dedicated test).
- Postman collections 7, 7b, 7c, 7d and 7e have still never been run (see the handoff).
