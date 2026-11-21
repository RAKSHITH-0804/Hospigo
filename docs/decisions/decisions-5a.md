# Decisions, Step 5a (split payment, doctor queue, consultation, vitals, prescription)

Step 5a is three sub-steps with their own commits. PR 1 is 5a-1 alone; PR 2 holds 5a-2 and 5a-3 together.

| PR  | Branch                                  | Title                                                                             |
| --- | --------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | `feature/phase2-step-5a1-split-payment` | Step 5a-1: split payment with one receipt (database, API, reception screen)       |
| 2   | `feature/phase2-step-5a2-5a3-clinical`  | Step 5a-2 and 5a-3: doctor queue, consultation notes, vitals and prescription API |

## 5a-1: split payment, ONE receipt (migration part)

- **Scope (approved 18 Nov):** a bill paid with several modes at once (UPI 300 + cash 200 on a bill of 500) gets ONE receipt number. True part payment (pay the rest later, visit queued before the bill is fully paid) is NOT in 5a: it needs a queue-gate change and an exception permission, left for a later step.
- **New table `receipts`** (append-only, forced row level security, app role SELECT/INSERT only, hq and patient roles no grants): receipt number (unique per hospital), bill, branch, total, issued by, idempotency key. `payments.receipt_number` is gone; every payment points to its receipt (`payments.receipt_id`).
- **Migration `20261119090000_split_payment_receipts`:** new migration because the 4a migration is pushed. Existing payments each get one receipt that carries their old number (checked on the real dev data inside a rolled-back transaction: 15 payments, 15 receipts, identical numbers and amounts, deferred checks pass).
- **Database rules:** a receipt equals the sum of its payments at commit and has at least one (deferred check on both tables, so a payment slipped onto an old receipt is refused too); one payment mode at most once per receipt (UPI 300 + UPI 200 is UPI 500); a payment sits on a receipt of the same bill (composite foreign keys, so same branch and hospital too); the receipt number is unique per hospital.
- **Bug found while testing (fixed in the migration):** inserting a receipt first takes a weak lock on the bill through the foreign key, and the payment trigger then asks for the strong lock: two parallel payers would deadlock. A `receipts_before_insert` trigger now takes the strong bill lock first (and runs the same hospital check as the payment trigger), so parallel payers queue up. Tested with 12 and 8 parallel payers.
- **A later payment needs its own receipt:** a receipt is closed once issued. The future "pay the rest later" step issues a second receipt.
- **Service change in this part:** only the minimum so the single-cash path still works (create the receipt, then the payment). The `payments` list in the API and the web rows come after this migration is approved.

## 5a-1: API and web part (decided while building)

- **API:** `POST /opd/visits` takes an optional `payments` list (1 to 4 lines, limit in `OPD_VISITS_CONFIG.maxPaymentLines`): `{ paymentModeCode, amountPaise, referenceNo? }`. The amounts must add up EXACTLY to the total (`400 PAYMENT_SUM_MISMATCH { totalPaise, paidPaise }`); one mode only once (`400 PAYMENT_MODE_DUPLICATE`); a mode that needs a reference must have one; unknown or inactive modes are `400 PAYMENT_MODE_NOT_AVAILABLE`. `payments` together with `paymentModeCode` / `referenceNo` is `400 PAYMENT_FIELDS_CONFLICT`; a list for a free visit is `400 PAYMENT_NOT_EXPECTED`. The old single-mode request still works unchanged. A present `payments: null` is `400` (it is never read as "absent").
- **One receipt:** one receipt number (taken from the hospital series once) for all lines. The first payment keeps the request's idempotency key; later lines get `<key>#2`, `<key>#3` (the key pattern has no `#`, so a caller key can never collide). Audit: one `OPD_PAYMENT_RECEIVE` per payment with mode and amount, never the reference number.
- **Replay:** the same key with the same split returns the same visit and receipt (200, order of lines does not matter); the same key with other amounts, other modes or a different way of paying (split versus single mode) is `409 IDEMPOTENCY_KEY_REUSED`.
- **Race found and fixed:** two identical requests at the same moment could make the second one price a moment after the first had charged the registration fee and answer `400 PAYMENT_SUM_MISMATCH` (or `409 PRICE_CHANGED`) instead of the replay. Now, when a request fails but its key has meanwhile produced a committed visit, the caller gets that visit back (tested with 4 rounds of 8 parallel requests; the older `PRICE_CHANGED` case had the same window).
- **New read endpoint `GET /opd/payment-modes`** (permission `opd.billing.collect`, OPD module): active modes `{ code, name, requiresReference }` (no ids), the default mode first, `defaultCode` and `maxLines`. The screen hardcodes none of it. Needed because the reception screen had no way to list modes.
- **Bill view:** `bill.receipts[]` (`receiptNumber`, `totalPaise`, `issuedAt`) next to `bill.payments[]` (each payment still carries its `receiptNumber`). Nurse and doctor (no `opd.billing.read`) still see no money and no receipts.
- **Web:** the New visit screen has a Payment box. One row pays the whole total (nothing to type). "Add payment mode" makes a split: the first row shows the total to cut down, amounts are typed in rupees (parsed to integer paise, at most 2 decimals), a counter shows what is still to collect or over, and the button is enabled only when the rows add up exactly, modes differ and references are filled. Any change of a row is a new request, so it gets a new idempotency key; a retry of the same rows keeps its key. Choosing another doctor or visit type starts again from one default row. The button says "Take cash" for one cash row and "Take payment" otherwise; a free visit shows no payment box and sends no list. The receipt prints ONE receipt number and one line per mode.
- **Not in this PR:** true part payment (pay the rest later, queue before fully paid), refunds, receipt print settings (Step 7).

Tests: API 408 -> 427 (split, shape, replay, race, permissions, payment modes), web 501 -> 556 (money parser, plan rules, form rows, page, receipt). Every new rule was removed one at a time and a test failed each time (two equivalent cases: the single-row plan ignores leftover text, and the submit-time guard sits behind the disabled button).

## PR 2: Step 5a-2 and 5a-3 (doctor queue, notes, vitals, prescription API)

PR title: **Step 5a-2 and 5a-3: doctor queue, consultation notes, vitals and prescription API**. Branch `feature/phase2-step-5a2-5a3-clinical`. One migration (`20261120090000_clinical_notes_vitals_prescription`), one new API module `apps/api/src/modules/opd-clinical/`. No web screens (that is Step 5b).

### Migration (what the database itself guarantees)

- `consultations` (one per visit), `consultation_addenda`, `visit_vitals`, `prescription_items`; forced row level security by hospital; `hospigo_hq` / `hospigo_patient` have no grants; same-hospital and same-branch composite foreign keys.
- A note can be created only while the visit is `IN_CONSULTATION`, only for the visit's own doctor, and starts as `DRAFT`. A `COMPLETED` note is frozen (no update, no delete, owner included). Finishing a note needs complaints or diagnosis to hold text.
- **A visit can become `COMPLETED` only after its note is `COMPLETED`** (the Step 4a visit guard was extended). Three older test fixtures that completed a visit with raw SQL now write a completed note first.
- Addenda are append-only (who, when, why), only on a completed note and only by the visit's doctor.
- Vitals are append-only and versioned: version 1 is the reading, every later version is a correction and needs a reason; versions have no gaps; name, unit and kind are copied from the master at write time (a later master change never rewrites history); only for a visit that has joined the queue (WAITING, IN_CONSULTATION, COMPLETED).
- Prescription rows belong to one `DRAFT` note and are frozen with it (the note row is locked FOR SHARE, so a row cannot slip in while the note is being completed); a listed medicine's name must be a true copy of the medicines list; free text has no medicine id and is flagged `is_unlisted`.

### Decisions made while building (not in the task)

- **Doctor scope:** a user with a doctor profile sees and changes only their OWN visits (everywhere: queue, note, vitals). A user with no doctor profile (a nurse) works across the active branch. A user with the notes permission but no profile gets `403 DOCTOR_PROFILE_REQUIRED`. Another doctor's, another branch's or another hospital's visit is always `404 VISIT_NOT_FOUND` (never a hint it exists).
- **Permissions:** `opd.queue.read`, `opd.vitals.read`, `opd.vitals.write`, `opd.notes.read`, `opd.notes.write` added to the catalog. Doctor: all five plus the earlier ones; Nurse: queue, vitals read/write, notes read. Admin roles still get none of them.
- **Queue:** every `WAITING` and `IN_CONSULTATION` visit of the token's branch in payment order. (First built as "today only"; changed in Step 5b after a test across midnight made every waiting patient vanish. Each item carries its own `visitDate`. Old waiting visits stay until the doctor completes them; cancelling a no-show is a later step.) The list also holds the visits COMPLETED today, after the open ones, so doctors, nurses and reception can see who has been attended.
- **One row lock per visit:** every doctor write and every vitals write first locks the visit row (`SELECT ... FOR UPDATE`), so a double click, a nurse and a doctor at the same moment, or "complete" racing "save" run one after the other. The raw query is allowlisted in the tenant safety-net scan.
- **Start and complete are replay-safe:** a second Start click returns the same state (`replayed: true`, one audit row); a second Complete returns the finished result.
- **Note save is a full replace** of the four fields (a field left out is cleared). Complete takes no body (the screen saves the draft first); completing needs complaints or diagnosis (`400 NOTE_EMPTY`).
- **Prescription is replaced as a whole** (`PUT`, 0 to 30 rows); a listed row carries `medicineId` (only active medicines of this hospital; the name is copied by the server), a free-text row carries `medicineName` and is flagged unlisted. Dose, frequency and duration are required.
- **Vitals:** a reading equal to the latest one changes nothing (a double click is harmless); a different value for a field that has a reading is a correction and needs a reason. Numbers: 0 or more, at most 2 decimals; text up to 200 characters. One request records several fields all or nothing. `outOfRange` comes from the field's warning range.
- **Audit stores field names and ids, never text or values:** `OPD_VISIT_START`, `OPD_NOTE_SAVE` (names of filled fields), `OPD_PRESCRIPTION_SAVE` (counts), `OPD_VISIT_COMPLETE`, `OPD_NOTE_READ` (EVERY read of a note, with who and which visit; a 404 read is not audited), `OPD_NOTE_ADDENDUM`, `OPD_VITALS_RECORD` (field codes). Vitals reads are not audited (only notes, as agreed in Q6).
- **New read route `GET /opd/medicines?q=&limit=`** (permission `opd.masters.read`): active medicines by name, code or composition, for the prescription picker. Added because the doctor had no way to pick from the list.

### Tests

API 427 -> 484 (database rules 48 -> 63 in `visits-billing.spec.ts`, 42 new endpoint tests in `opd-clinical.endpoints.spec.ts`, RLS spec extended with the four new tables). Every rule was removed one at a time: API 33 checks (all killed; three survivors were equivalent because a second check refuses the same request, and one real gap, a read-only doctor, got its own test) and database 25 of 27 killed (one equivalent: a draft note can only exist while its visit is in consultation; one pattern did not match its text).

### Not in this PR

Screens (5b), cancelling a visit, investigations and refunds (6a), cross-branch note history, true part payment.
