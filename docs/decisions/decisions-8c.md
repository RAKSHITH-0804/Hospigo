# Decisions, Step 8c (settings and gaps)

Branch: `feature/step-8c-settings-and-gaps`, from `develop` at `2e333ef` (the merge of 8b, PR #60). One branch, one PR. Decisions by Rakshith, 24 Nov 2026, with the reasons.

## Decisions

1. **Order of 8c versus Step 9.** 8c now comes BEFORE Step 9 (it was "after Step 9" in the tracker, the handoff and decisions-8b). _Why:_ 8b finished early, the items are gaps a real hospital meets on day one, and Step 9 ends with a full test of everything, which should include them.
2. **All ten items in one go**, in this order, one commit group per item so what is finished is always shippable: (4) doctor fee structure, (6) queue doctor filter, (2) payment modes, (3) vitals fields, (1) number series, (7) patient reference field set, (5) voided token marker, (9) doctor leave requests with approval, (8) per-branch print templates, (10) extra print values.
3. **Cut rule.** If time runs short, stop at a clean commit boundary (never in the middle of an item), finish docs and tests for what is built, put the rest on a separate local branch and say so in the report.
4. **NOT built in 8c:** cancelling visits that are not WAITING (it changes money and refund rules, so the manager must decide), part payment, the pending dues list, the Emergency flag, online booking.
5. **One PR for all of 8c.** Migrations are named after `20261127090000`, one per concern, applied ONLY to `hospigo_test`; Rakshith migrates the dev database. Money rules, append-only guarantees and tenant isolation are never weakened.

## Item decisions given with the order

- (4) Option A, no migration: the follow-up fee falls back to the new-visit fee when no FOLLOW_UP row exists; existing follow-up rows stay as overrides; the way back from an override is typing the same amount (it then no longer follows the base). Screen text says so.
- (2) "Requires reference" is ENFORCED at payment (UPI and Card must carry a reference, cash does not). This changes money collection and is a review gate.
- (1) Safe version: prefix, separator, width and financial-year style are editable; the reset rule and the financial-year start month are locked once any number exists; the start number is raise-only with a reason; a database trigger refuses a counter going down.
- (7) Built on the existing custom fields, no new table.
- (5) Marker only, no change to what can be cancelled.
- (9) Answers to the plan questions: Branch Admin (own branches) and SuperAdmin approve; an approved leave cannot be cancelled by the doctor (an Admin removes it in Availability); no free text (a fixed list of reasons or none); no email.
- (8) Lookup order branch, hospital, built-in default; a Branch Admin manages only their own branch; hospital-wide templates stay SuperAdmin-only.
- (10) The smallest safe version of "extra print values" (see its section below).

## Notes added while building

(See the sections below as each item is finished.)

## (4) Doctor fee structure (built)

- No migration. `resolveDoctorFee` (`apps/api/src/modules/opd-masters/doctor-fee.ts`) is the one place that picks a fee: a new-visit fee is the latest NEW row that has started; a follow-up fee is the latest FOLLOW_UP row that has started, and with none, the new-visit fee. Visit pricing, the doctor picker (`feeFollowUpPaise`) and `PriceService.getDoctorFee` use it. A bill line still keeps the id of the row that was used, so bills already made are untouched; the free-follow-up window and the starter script are unchanged.
- Existing follow-up rows stay as separate fees. A separate follow-up fee, once set, does not follow later changes of the new-visit fee. Fee rows are append-only, so the way back to "same price" is to type the same amount as the new-visit fee (a later flag column could make this cleaner; not needed now).
- Prices list: a follow-up row with no separate fee carries `followsBase` and shows the new-visit price with "(same as new visit)" and the button **Set separate follow-up fee**; the form and the history say what this means.
- Excel (Doctor fees): the new-visit fee is required (in the file or already saved), the follow-up fee is optional. The row reason `DOCTOR_NEEDS_BOTH_TYPES` became `DOCTOR_NEEDS_NEW_FEE`; its tests and the screen text were updated on purpose.

## (6) Queue doctor filter (built)

- `GET /opd/queue?doctorProfileId=` narrows the list to one doctor. A doctor still sees only their own visits whatever is asked (the filter can never widen it, and a doctor gets no doctor list). A malformed id is refused (400); an unknown doctor or one of another hospital gives an empty list (the tenant filter applies).
- For the whole-branch scope the answer also lists the doctors that have visits in the branch queue (`doctors`), taken from the unfiltered list so the choices do not shrink when one is picked. No migration, no new permission.
- Screen: a **Doctor** dropdown (All doctors, then each doctor) above the list for nurse and reception; the choice stays through Refresh and the automatic refresh.

## (2) Payment modes (built)

- **Correction of the plan:** the plan said the "requires reference" flag was not enforced anywhere. That was wrong. The check already exists in `planPayments` (visit payments, test bills, single and split payments: `REFERENCE_REQUIRED`) and in the refund code (a refund line of such a mode needs its reference). It was not changed in 8c, so no payment or refund behaviour changed and no existing Postman collection needed an edit. New tests (`billing-helpers.spec.ts`) pin the rule: cash needs no reference, UPI and card do, a split checks every line, the flag of the mode as it is NOW decides, a switched-off mode is refused, a free bill takes no payment.
- New API (module `masters-admin`, no migration: the application login already has SELECT, INSERT and UPDATE on `payment_modes`): `GET/POST /settings/payment-modes`, `PUT /settings/payment-modes/:id`. Permission `opd.masters.write` for all of them (reception, nurse and "nobody" are refused, a Branch Admin is allowed as for the prices).
- Rules: code is made upper case, 2 to 20 characters (A to Z, digits, `_`), unique per hospital, **never changed**; name is plain text (no `<` or `>`), at most 40 characters; at most 30 modes. **Never deleted** (no route; payments and refunds point at modes). **Cash cannot be deactivated** (billing uses it as the default) and **at least one mode stays active**. A mode switched off is not offered when taking payment and comes back when switched on. The flag decides for NEW payments and refunds only.
- Two changes at the same moment run one after the other (the settings row is locked for the transaction). Audit: kind and the NAMES of the changed fields only. A change that changes nothing writes nothing.
- Screen: Settings, Billing, **Payment modes** (list with reference rule, status and how often it was used; Add and Edit in a pop-up; Activate and Deactivate; help block).

## (3) Vitals fields (built)

- New API (same module, no migration): `GET/POST /settings/vitals-fields`, `PUT /settings/vitals-fields/:id`, `POST /settings/vitals-fields/reorder`. Permission `opd.masters.write`.
- Rules: code (small letters, digits, `_`) and kind (number or text) never change; name and unit are plain text; a usual range (`warnMin`, `warnMax`, at most 2 decimals, highest above lowest) only for number fields, `null` clears a limit; fields are never deleted, only deactivated; reorder needs the complete list of the hospital's field ids (another hospital's id or a missing id is refused). A reading keeps its own copy of the name, unit and kind, so editing a field never rewrites what was recorded.
- **The warning** (warn only, never blocks): the nurse screen already marked a saved reading outside the range; 8c adds the warning while typing ("Outside the usual range. Usual range: 50 – 120. Please check the reading. It can still be saved."). A field without a range, and a text field, never warn.
- Screen: Settings, OPD, **Vitals fields** (list with unit, type, range and status; Add and Edit in a pop-up; up and down arrows; Activate and Deactivate; help block).

## Menu grouping

The settings menu got a new heading **Billing** (Prices, Payment modes, and later Bill numbers). OPD keeps OPD rules, Vitals fields and Upload lists. A heading with nothing the person may open is left out, as before.

## Test kit

`apps/api/src/database/hospital-test-kit.ts` (not part of the build: excluded in `tsconfig.json`) gives the 8c HTTP specs the same set-up: test environment, booted app with the given clock, hospitals with a Main and an East branch, and people with a role or a made-up permission list.

## (1) Number series (built, safe version)

- **Migration `20261127100000_number_series_protection`** (applied to `hospigo_test` only). What already existed: a trigger that lets `number_series.last_number` only move forward (`number_series_forward_only`, Step 3a/4a) and a unique bill, receipt and refund number per hospital. What was missing, and is now added: (1) a counter row can never be **deleted or emptied** (delete and truncate triggers, the owner login too, as Step 7f did for `uhid_counters`); (2) the **key** of a counter (hospital, series, period) can never change, so a counter cannot be moved to another period to restart the count; (3) `number_series_settings.reset_rule` and `fy_start_month` **cannot change once any counter row of the series exists** (checked only when one of the two really changes, as the caller, so row level security shows the caller's hospital). The decrease protection the plan asked for therefore needed no new trigger, only the three holes above were closed.
- **API** (module `masters-admin`, permission `opd.settings.write` AND a hospital-wide Admin: money numbering, so a Branch Admin gets 403): `GET /settings/number-series` (per series: parts, reset rule, locked, last number of the current period, the next number as it will look, and the hospital's date), `PUT /settings/number-series/:series` (prefix, separator, financial year style, width; reset rule and financial year start only before the first number), `PUT /settings/number-series/:series/start-number` (raise-only, reason needed).
- Rules: the format is always prefix (0 to 8 of letters, digits and `. / _ -`), financial year (short 2627 or long 2026-27), separator (none, `-`, `/`, `.`, `_`), number (1 to 10 digits). A stored format of another shape (a custom one) is shown with its next number but not edited. **A number once issued is never touched; a change only affects new numbers.** A format change after the first number is checked against the numbers already issued: the next 1000 numbers it would give must not exist as a bill, receipt or refund number (refused with `NUMBER_EXISTS`); beyond that the unique key of the table still stops a repeat. The start number raises the counter of the current period so the NEXT number is the one asked for; it never lowers it (`NOT_RAISING`), the same number is a quiet no-op, and it refuses a number that already exists. The raise is one atomic "update where the counter is lower", so it cannot overwrite a number taken at the same moment. It needs a reason (plain text, 200 characters), kept as the reason of the audit row (as for the patient number start); the audit metadata holds the series, period and the counter before and after, and for a format change only the NAMES of the changed fields.
- Screen: Settings, Billing, **Bill numbers**: a card per series with the next number, the last number, the count rule and a note when it is locked; **Change format** and **Set start number** open pop-ups with a live preview worked out with the same rules (`lib/masters/number-preview.ts`).
- Not done on purpose: the reset rule cannot be changed after the first number (a new count would repeat numbers); there is no way to lower a counter.

## (7) Patient reference field set (built)

- Built on the existing custom fields (Step 7b), **no new table, no migration**. The set (`apps/api/src/modules/patients/patient-reference-fields.ts`): **Referred by** (text), **Category** (dropdown: General, Staff, Insurance, Senior citizen), **Organisation** (text), **Staff number** (text), all in the section Other, on the form, not required.
- Admin: Settings, Patients, Registration fields, **Add ready-made fields** (`POST /settings/patient-fields/reference-set`, permission `hospital.settings.write`). It adds only what is missing: a field whose name is already used (any letters) is **left exactly as it is** (its type, section, required flag and choices are not touched). Pressing it again, or two Admins at the same moment, adds each field once (the answer lists `created`, `kept` and `skipped`; `skipped` are the fields left out because the hospital reached the limit of 30 own fields). The screen reads the form again and says what was added. Each field can then be renamed, moved, made required or switched off like any own field; answers are never deleted.
- Starter script: `--reference-fields` adds the same set (dry run supported), never overwrites, writes the same rows, and is off by default, so an older runbook behaves as before.
