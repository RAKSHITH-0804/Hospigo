# OPD API reference

Fake data only. Grows with each OPD step.

## Permissions

| Code                      | Used by                            |
| ------------------------- | ---------------------------------- |
| `patients.registry.read`  | form-config, list, search, detail  |
| `patients.registry.write` | register, update                   |
| `hospital.settings.read`  | UHID start-number GET (preview)    |
| `hospital.settings.write` | UHID start-number PUT (raise-only) |

All patient routes require a **HOSPITAL** access token and (except start-number) an enabled **OPD** branch module.

---

## GET /patients/form-config

**Permission:** `patients.registry.read` (+ OPD module)

**Response 200**

```json
{
  "fields": [
    {
      "key": "name",
      "label": "Full name",
      "dataType": "TEXT",
      "required": true,
      "sortOrder": 0,
      "section": "PERSONAL"
    },
    {
      "code": "title",
      "label": "Title",
      "dataType": "DROPDOWN",
      "required": false,
      "sortOrder": 100,
      "section": "RELATIVE",
      "options": [{ "id": "clx…", "label": "Mr", "sortOrder": 0 }]
    }
  ]
}
```

Fields are ordered by section (`PERSONAL`, `CONTACT`, `ADDRESS`, `RELATIVE`, `OTHER`) then `sortOrder`. Built-in `section` comes from the catalog; custom fields store their own `section` (default `OTHER`).

**Always required (cannot be disabled by hospital settings):** `name`, `phone`, and age-or-DOB (`date_of_birth` / `ageYears` — exactly one).

---

## GET /patients

**Permission:** `patients.registry.read` (+ OPD module)

Declared before `GET /patients/:id`.

**Query:** optional `sort` = `newest` | `oldest` | `name_asc` | `name_desc` | `uhid_desc` | `uhid_asc` (default `newest`; an unknown value is `400`); optional `page`, `pageSize` (same cap as search: `PATIENT_SEARCH_MAX_PAGE_SIZE`); optional at most one of `uhid`, `phone`, `name` (same normalisation / min-name rules as search); **or** optional free-text `q` (trimmed, max `PATIENT_LIST_Q_MAX_LENGTH`). `q` cannot be combined with `uhid` / `phone` / `name`. No filter = list all active patients.

**UHID sort:** `uhid_desc` is `ORDER BY length(uhid) DESC, uhid COLLATE "C" DESC, id DESC`; `uhid_asc` is the exact reverse. Shorter UHIDs come first when ascending (`TESTA0999` before `TESTA10000`), and text is compared in plain character order (independent of the database locale). Known limit: after a UHID format change, the old and new formats are ordered by length, then text, so they do not interleave by registration date.

**`q` matching (case-insensitive, any arm):** name prefix or word-prefix when `q` length ≥ `PATIENT_LIST_Q_MIN_NAME_LENGTH` (default 2); UHID prefix when length ≥ `PATIENT_LIST_Q_MIN_UHID_LENGTH` (default 2); phone national-number prefix when `q` has ≥ `PATIENT_LIST_Q_MIN_PHONE_DIGITS` digits (default 3) — spaces/dashes stripped, and a leading `+` / `91` removed only when `q` starts with `+`. LIKE wildcards in `q` are escaped (literal). Too short for every arm → `400` with `fieldErrors.q = INVALID`.

**Known limits:** contains-search (e.g. last digits of a phone) is not supported; very large tables would need a `pg_trgm` index (not added yet).

**Sort:** `newest` = `created_at DESC, id DESC`; `oldest` = `created_at ASC, id ASC`; `name_asc` / `name_desc` = `lower(name)` then `id`.

**Response 200**

```json
{
  "items": [
    {
      "id": "clxpatient01",
      "uhid": "NREG0001",
      "name": "Mock Alpha",
      "gender": "F",
      "dateOfBirth": "1990-01-15",
      "ageYears": 36,
      "dobIsEstimated": false,
      "phone": "+919876543210",
      "registeredBranchId": "clxbranch01",
      "registeredBranchName": "Main",
      "isActive": true,
      "createdAt": "2026-01-15T12:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

**Errors:** `400` when more than one filter, `q` with another filter, invalid sort, name too short, or `q` too short / too long (`fieldErrors.q`).

---

## GET /patients/search

**Permission:** `patients.registry.read` (+ OPD module)

**Query:** exactly one of `uhid`, `phone`, `name`; optional `page`, `pageSize` (capped by `PATIENT_SEARCH_MAX_PAGE_SIZE`, default 50). Name prefix minimum length from `PATIENT_SEARCH_MIN_NAME_LENGTH` (default 3).

**Response 200**

```json
{
  "items": [
    {
      "id": "clxpatient01",
      "uhid": "NREG0001",
      "name": "Mock Alpha",
      "gender": "F",
      "dateOfBirth": "1990-01-15",
      "ageYears": 36,
      "dobIsEstimated": false,
      "phone": "+919876543210",
      "registeredBranchId": "clxbranch01",
      "isActive": true
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

No audit row is written for search.

**Errors:** `400` when zero or more than one criterion, or name too short.

---

## GET /patients/:id

**Permission:** `patients.registry.read` (+ OPD module)

Writes audit `PATIENT_VIEW` (entity `patient`, `entityId`, `branchId`; metadata has no personal data).

**Response 200** — patient fields + `customFieldValues[]`.

**Errors:** `404` for unknown id or another hospital's id.

---

## POST /patients

**Permission:** `patients.registry.write` (+ OPD module)

Registering branch = **active branch from the token** (never from the body).

**Request**

```json
{
  "name": "Mock Alpha",
  "gender": "F",
  "dateOfBirth": "1990-01-15",
  "phone": "9876543210",
  "email": "mock.alpha@example.test",
  "customFieldValues": [{ "code": "title", "optionId": "clxopt01" }],
  "confirmDuplicate": false
}
```

Alternative to `dateOfBirth`: `ageYears` (integer) → estimated DOB in hospital timezone, `dobIsEstimated: true`. Exactly one of `dateOfBirth` or `ageYears` is required; both → `400` with `AGE_AND_DOB_BOTH`.

Phone is always required: valid Indian mobile, stored as `+91XXXXXXXXXX`.

`addressPincode` when provided must be exactly 6 digits (`PATIENT_PINCODE_LENGTH`); otherwise `fieldErrors.address_pincode = INVALID`. Optional unless the hospital marks it required.

**Response 200/201**

```json
{ "id": "clxpatient01", "uhid": "NREG0001" }
```

Audit `PATIENT_REGISTER` with metadata `{ uhid, branchId }` only.

**Errors**

| Status | Code / meaning                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 400    | Validation body (below)                                                                                                      |
| 409    | `{ "statusCode": 409, "code": "POSSIBLE_DUPLICATE", "matches": [{ "id", "uhid", "name" }] }` unless `confirmDuplicate: true` |

**400 `fieldErrors` (codes only; `message` kept for compatibility)**

```json
{
  "statusCode": 400,
  "message": "Send dateOfBirth or ageYears, not both",
  "error": "Bad Request",
  "fieldErrors": {
    "date_of_birth": "AGE_AND_DOB_BOTH",
    "ageYears": "AGE_AND_DOB_BOTH"
  }
}
```

- **Codes:** `REQUIRED`, `INVALID`, `AGE_AND_DOB_BOTH`
- **Keys:** form-config catalog keys for built-ins (`name`, `phone`, `date_of_birth`, `address_pincode`, …); `custom.<code>` for custom fields; `ageYears` for the DTO age field when both age and DOB are sent
- One 400 returns every `fieldErrors` entry together: class-validator DTO codes are merged with service checks (phone, pincode, age-or-DOB, required customs); each field keeps a single code

---

## PATCH /patients/:id

**Permission:** `patients.registry.write` (+ OPD module)

Partial update of the same fields as register. Sending `uhid`, `tenantId`, or `registeredBranchId` → `400`. Database trigger also refuses mutating `uhid` / `registered_branch_id`. A patch may not blank always-required name, phone, or age-or-DOB. Same `fieldErrors` shape as POST on validation failure.

Audit `PATIENT_UPDATE` with metadata `{ changedFields: [...] }` only (no old/new values).

---

## GET /patients/uhid/start-number

**Permission:** `hospital.settings.read` (no OPD module gate)

Read-only. Does not insert a counter row, increment, or write audit. Declared before `GET /patients/:id` so `uhid` is not treated as an id.

**Response 200**

```json
{
  "nextNumber": 1,
  "nextUhidPreview": "TESTA0001",
  "resetRule": "NEVER",
  "periodYear": 0,
  "periodLabel": null
}
```

`periodLabel` is `null` when `resetRule` is `NEVER`; otherwise the financial-year label from the effective format (same helper as UHID rendering). Preview uses the caller’s active branch code when the format includes a `BRANCH_CODE` block. Missing counter row → `nextNumber` 1.

**Errors:** `400` if no effective UHID format config; `401` / `403` as for other patient routes.

---

## PUT /patients/uhid/start-number

**Permission:** `hospital.settings.write` (no OPD module gate)

**Request**

```json
{ "startNumber": 5000, "reason": "Skip imported block" }
```

Raises the counter for the **current period** resolved from the effective UHID format (`NEVER` → `periodYear` 0; `FINANCIAL_YEAR` → current FY start year). Raise-only: `startNumber` must be greater than the period’s current `last_number` (so `startNumber` equal to the current next number is allowed and leaves `last_number` unchanged). Audit `UHID_SET_START_NUMBER` with metadata `{ periodYear, previousLastNumber, nextNumber }`.

**Errors:** `400` if decrease attempted, reason empty/whitespace, or no effective format; `403` without permission.

---

## Auth refusals (all routes above)

| Caller                            | Typical status |
| --------------------------------- | -------------- |
| No token                          | 401            |
| Patient / HQ token (wrong kind)   | 401            |
| Hospital token without permission | 403            |

---

# Visits and billing (Step 4a)

Money is integer paise everywhere. The **branch, tenant and user always come from the token**, never from the body. Reads show only the **active branch** of the token. Failures return `{ statusCode, code, ... }`; the API carries no UI text.

## Permissions

| Code                  | Used by                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `opd.visits.create`   | `GET /opd/doctors`, `POST /opd/visits` (the route; taking the money also needs collect) |
| `opd.billing.collect` | `POST /opd/visits` (checked inside; without it the call is 403 and nothing is created)  |
| `opd.visits.read`     | `GET /opd/visits/:id`, `GET /patients/:patientId/visits`                                |
| `opd.billing.read`    | money in the two read routes (without it the response has no `bill` at all)             |

SuperAdmin and Branch Admin (system roles) get only `opd.visits.read` and `opd.billing.read`. Receptionist gets all four. Nurse and Doctor get `opd.visits.read`; a doctor who cannot read bills sees only their own visits. All routes also need the OPD module on the active branch.

## GET /opd/doctors

Doctors whose login is a member of the active branch (active profile, active user): `{ items: [{ id, code, name, department, available, unavailableReason, outsideTimings, feeNewPaise, feeFollowUpPaise }] }`. `unavailableReason` is `SWITCH_OFF` or `ON_LEAVE`; an unavailable doctor cannot be assigned. Fees are the current price-list value (null when not configured).

## POST /opd/visits (visit + bill + cash payment in ONE transaction)

```json
{
  "patientId": "clxpatient01",
  "doctorProfileId": "clxdoctor01",
  "visitType": "NEW",
  "idempotencyKey": "one-key-per-click-1234",
  "paymentModeCode": "CASH",
  "referenceNo": "optional, required when the mode needs one"
}
```

There is no branch, amount, tax or status field (unknown fields are `400`). The server prices the visit:

- consultation fee = the doctor's current fee for the visit type; **registration fee** is added only when the patient has no active registration-fee record (once per patient, all branches);
- `FOLLOW_UP` needs a **completed** earlier visit of the same patient with the same doctor (any branch), else `400 FOLLOW_UP_NEEDS_PREVIOUS_VISIT`. If that visit's day is within `follow_up_free_days` of today (hospital time zone) the consultation line is `0` with `pricingNote: FOLLOW_UP_FREE_WINDOW`: the bill is settled with no payment, but still has a bill number and a token;
- paid in full by the chosen mode (default `CASH`); bill number and receipt number come from the hospital series, the token from the branch's day series (hospital time zone, restarts at 1 each day); the visit becomes `WAITING`.

Response `201` (new) or `200` (same `idempotencyKey` again: the same visit, bill and receipt are returned with `replayed: true`; the same key with a different patient, doctor, type or branch is `409`). The body is the visit view: `id, status, visitType, visitDate, branch, patient{id,uhid,name}, doctor{id,code,name}, token{date,no,label}, bill{billNumber, totalPaise, paidPaise, paymentStatus, lines[], payments[]}`.

| Status | Code                                                     | Meaning                                                                  |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| 400    | validation                                               | unknown field, bad type, oversized value                                 |
| 400    | `DOCTOR_UNAVAILABLE` (+ `reason`)                        | switch off or on leave                                                   |
| 400    | `DOCTOR_NOT_IN_BRANCH`                                   | the doctor is not a member of the active branch                          |
| 400    | `FOLLOW_UP_NEEDS_PREVIOUS_VISIT`                         |                                                                          |
| 400    | `PAYMENT_MODE_NOT_AVAILABLE`, `REFERENCE_REQUIRED`       | unknown or inactive mode; mode needs a reference                         |
| 403    | `FORBIDDEN`                                              | no `opd.billing.collect` (or no `opd.visits.create`); nothing is created |
| 404    | `PATIENT_NOT_FOUND`, `DOCTOR_NOT_FOUND`                  | unknown, inactive, or another hospital's (same answer)                   |
| 409    | `FEE_NOT_CONFIGURED` (+ `what`)                          | no fee in the price list; nothing is billed as zero by accident          |
| 409    | `IDEMPOTENCY_KEY_REUSED`, `NUMBER_SERIES_NOT_CONFIGURED` |                                                                          |
| 501    | `TAX_NOT_SUPPORTED`                                      | tax is switched on in the hospital settings but tax billing is not built |

Everything is in one database transaction: a refused or failed request stores nothing and burns no bill, receipt or token number. The database also refuses wrong money (see `docs/schema-opd.md`, "As built (Step 4a)").

## GET /opd/visits/:id

One visit of the **active branch** with its bill, lines and payments when the caller has `opd.billing.read`; otherwise the same visit without any `bill`. A visit of another branch or hospital, an unknown id, or (for a doctor) another doctor's visit is `404 VISIT_NOT_FOUND`.

## GET /patients/:patientId/visits

Visits of one patient in the active branch, newest first: `{ items, total, page, pageSize }` (`page`, `pageSize` capped at 100). Items carry a bill summary (no lines or payments) for callers with `opd.billing.read`. Same branch and doctor rules as above; an unknown or foreign patient is `404 PATIENT_NOT_FOUND`.

## Step 4b additions: price preview and the expected-total check

**POST /opd/visits/preview** (permission `opd.visits.create`, OPD module): body `{ patientId, doctorProfileId, visitType }` only. Same checks and refusals as the real create (tax, patient, doctor, branch membership, availability, fees, follow-up rules). It writes nothing and takes no bill, receipt or token number. Response:

```json
{
  "visitType": "NEW",
  "visitDate": "2026-11-18",
  "doctor": { "id": "clxdoctor01", "code": "DR002", "name": "Doctor North 2" },
  "lines": [
    {
      "kind": "CONSULTATION",
      "code": "DR002",
      "description": "Doctor North 2",
      "quantity": 1,
      "unitPricePaise": 50000,
      "lineTotalPaise": 50000,
      "pricingNote": null
    },
    {
      "kind": "REGISTRATION",
      "code": "REG",
      "description": "Registration",
      "quantity": 1,
      "unitPricePaise": 10000,
      "lineTotalPaise": 10000,
      "pricingNote": null
    }
  ],
  "totalPaise": 60000,
  "followUpFree": false,
  "registrationIncluded": true,
  "sameDayVisitWithDoctor": false
}
```

`sameDayVisitWithDoctor` is true when the patient already has a visit (not cancelled) with this doctor today at any branch: a warning for the screen, never a block.

**`expectedTotalPaise` on POST /opd/visits** (optional, whole number 0 to 2147483647): the total the screen showed. If the server now calculates a different total the call is refused with `409 PRICE_CHANGED { totalPaise, expectedTotalPaise }` and nothing is created, charged or numbered. The reception screen always sends it. A present value must be a whole number (`null`, text and decimals are `400`); zero is a real value.

## Free repeat visit with the same doctor (Step 4a, hospital setting)

Setting `opd_settings.repeat_visit_free_hours` (whole hours, 0 to 8760, default **0 = off**). When it is above 0, a visit for the **same patient and same doctor** (any branch of the hospital) made less than that many hours after the **last paid consultation** has a consultation line of `0` with `pricingNote: REPEAT_VISIT_FREE_WINDOW`, even when `visitType` is `NEW`. The bill is settled with no payment but still has a bill number and a token (same as a free follow-up).

- The window counts from `queued_at` of the latest visit that is not cancelled, was queued, and whose bill is PAID with a consultation line above zero. A free repeat visit never becomes the anchor, so repeated free visits cannot extend the window.
- Exactly at the limit it is charged (`elapsed < window` is free). A different doctor, a different patient or another hospital is charged normally.
- A follow-up inside `follow_up_free_days` keeps its own label (`FOLLOW_UP_FREE_WINDOW`); the repeat rule only applies when the consultation is still above zero.
- Preview adds `repeatVisitFree: boolean` next to `followUpFree`. The audit entry of the visit carries `freeRepeatVisit: true` (and still `freeFollowUp`), no personal values.
- The setting has no API or screen yet: it is set in the database (demo seed: 24). The Admin settings screen is Step 7b.

## Step 5a-1: split payment and payment modes

**POST /opd/visits** accepts `payments` instead of `paymentModeCode` / `referenceNo`:

```json
{
  "patientId": "...",
  "doctorProfileId": "...",
  "visitType": "NEW",
  "idempotencyKey": "PM5A1-...",
  "expectedTotalPaise": 60000,
  "payments": [
    { "paymentModeCode": "UPI", "amountPaise": 10000, "referenceNo": "UTR-1" },
    { "paymentModeCode": "CASH", "amountPaise": 50000 }
  ]
}
```

- 1 to 4 lines, whole paise above zero, one mode once. The sum must equal the total exactly.
- ONE receipt for all lines. Response `bill.receipts: [{ receiptNumber, totalPaise, issuedAt }]` and `bill.payments[]` (each with the same `receiptNumber`).
- Refusals (all `400`, nothing stored or numbered): `PAYMENT_SUM_MISMATCH { totalPaise, paidPaise }`, `PAYMENT_MODE_DUPLICATE`, `REFERENCE_REQUIRED`, `PAYMENT_MODE_NOT_AVAILABLE`, `PAYMENT_FIELDS_CONFLICT` (list together with the single-mode fields), `PAYMENT_NOT_EXPECTED` (list for a free visit). A price change is still `409 PRICE_CHANGED` first.
- Idempotency: same key and same split = `200` replay; same key with another split or another way of paying = `409 IDEMPOTENCY_KEY_REUSED`.

**GET /opd/payment-modes** (permission `opd.billing.collect`): `{ items: [{ code, name, requiresReference }], defaultCode, maxLines }`, active modes of the hospital, default first.

## Steps 5a-2 and 5a-3: queue, consultation, prescription, vitals

All routes need a hospital token, the OPD module and the permission shown. The branch, hospital and user come only from the token. A doctor works only on their own visits; another doctor's, branch's or hospital's visit is `404 VISIT_NOT_FOUND`.

| Route                                       | Permission         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /opd/queue`                            | `opd.queue.read`   | Every WAITING and IN_CONSULTATION visit of the branch in payment order (oldest first; NOT limited to today, so a patient still waiting after midnight stays), followed by the visits COMPLETED today (hospital time zone), latest first. `date` is today; each item carries its own `visitDate`, `completedAt` and `vitalsRecorded`. A doctor sees only their own (`scope: OWN`); a nurse sees the branch (`scope: BRANCH`). Items: token, status, patient (name, uhid, gender, age), `vitalsRecorded`. No money. |
| `POST /opd/visits/:id/start`                | `opd.notes.write`  | WAITING to IN_CONSULTATION (sets `consultationStartedAt`). Second click: `200 replayed: true`. Not waiting: `409 VISIT_NOT_WAITING`.                                                                                                                                                                                                                                                                                                                                                                              |
| `PUT /opd/visits/:id/consultation`          | `opd.notes.write`  | Save the draft note: `complaints`, `diagnosis`, `advice`, `followUpDate` (YYYY-MM-DD, not before the visit day, within 366 days). Replaces all four. Only while IN_CONSULTATION (`409 VISIT_NOT_IN_CONSULTATION`).                                                                                                                                                                                                                                                                                                |
| `PUT /opd/visits/:id/prescription`          | `opd.notes.write`  | Replace the draft prescription: `{ items: [{ medicineId` or `medicineName, dose, frequency, duration, instructions? }] }` (0 to 30 rows). Errors: `MEDICINE_NOT_FOUND`, `PRESCRIPTION_ITEM_INVALID` (with `index`).                                                                                                                                                                                                                                                                                               |
| `POST /opd/visits/:id/complete`             | `opd.notes.write`  | Completes note and visit. `400 NOTE_EMPTY` without complaints or diagnosis. Second click: `200 replayed: true`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /opd/visits/:id/consultation/addenda` | `opd.notes.write`  | `{ text, reason }`: a correction of a completed note (`201`). `409 ADDENDUM_NEEDS_COMPLETED_NOTE`, `400 ADDENDUM_INVALID`.                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /opd/visits/:id/consultation`          | `opd.notes.read`   | Note, prescription, addenda. Doctor: own visit; nurse: any visit of the branch. EVERY read is audited. A visit without a note returns `consultation: null`.                                                                                                                                                                                                                                                                                                                                                       |
| `GET /opd/vitals-fields`                    | `opd.vitals.read`  | Active vitals fields (code, name, unit, valueKind, displayOrder, warnMin, warnMax). No ids.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /opd/visits/:id/vitals`                | `opd.vitals.read`  | Current value and full history per field (`version`, `correctionReason`, who, when, `outOfRange`).                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /opd/visits/:id/vitals`               | `opd.vitals.write` | `{ readings: [{ fieldCode, value, correctionReason? }] }`, all or nothing. Response lists `recorded`, `corrected`, `unchanged` plus the current view. Errors: `VITALS_FIELD_NOT_FOUND`, `VITALS_FIELD_DUPLICATE`, `VITALS_VALUE_INVALID` (with `fieldCode`), `VITALS_CORRECTION_REASON_REQUIRED`, `409 VITALS_VISIT_NOT_OPEN`.                                                                                                                                                                                    |
| `GET /opd/medicines?q=&limit=`              | `opd.masters.read` | Active medicines by name, code or composition (max 50).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Other error: `403 DOCTOR_PROFILE_REQUIRED` (notes permission but no doctor profile).

## Step 6a: tests ordered by the doctor, investigations bill, refunds, cancelling a visit

All routes need a hospital token, the OPD module and the permission shown (deny by default). Branch, hospital and user come only from the token; another branch's or hospital's visit, bill or request is `404`. Money is integer paise. Errors are `{ statusCode, code, ... }` (codes below).

New permissions: `opd.investigations.order` (doctor), `opd.investigations.bill` (receptionist), `opd.refunds.request` (receptionist), `opd.refunds.approve` (Admin roles; the admin roles never get the other three).

| Route                                      | Permission                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /opd/investigations/tests?q=&limit=`  | `opd.masters.read`                                  | Active tests by name or code (max 50): `{ items: [{ id, code, name }] }`. No prices.                                                                                                                                                                                                                                                                                                                                                                      |
| `PUT /opd/visits/:id/investigations`       | `opd.investigations.order`                          | `{ chargeItemIds: [...] }` (0 to 30). The assigned doctor replaces the tests still only ORDERED; billed or not-taken ones stay. Only while IN_CONSULTATION. Returns `{ orders: [{ id, chargeItemId, code, name, status, notTakenReason, billNumber, orderedAt, resolvedAt }] }`. Errors: `TEST_NOT_FOUND` 404, `TEST_DUPLICATE` 400, `TOO_MANY_TESTS` 400, `VISIT_NOT_IN_CONSULTATION` 409, `DOCTOR_PROFILE_REQUIRED` 403. Another doctor's visit is 404. |
| `GET /opd/visits/:id/investigations`       | `opd.visits.read` (+ order or bill permission)      | Tests of one visit. A doctor: own visit only, never money. Reception: any visit of the branch, plus `bills` (investigations bills with lines, receipts, payments) when the caller has `opd.billing.read`. `{ visitId, visitStatus, orders, bills? }`.                                                                                                                                                                                                     |
| `GET /opd/investigations/pending`          | `opd.investigations.bill`                           | Visits of the branch with tests ordered and not yet billed or declined, oldest order first: patient, doctor, token, `orders[]` with the CURRENT `pricePaise` (null when no price is set) and `totalPaise`.                                                                                                                                                                                                                                                |
| `POST /opd/visits/:id/investigation-bills` | `opd.investigations.bill` and `opd.billing.collect` | `{ idempotencyKey, orderIds: [...], notTaken?: [{ orderId, reason }], expectedTotalPaise?, payments? or paymentModeCode/referenceNo }`. ONE transaction: bill (INVESTIGATION), lines, ONE receipt, payments, ledger, orders BILLED, declined ones NOT_TAKEN. Same key and same request = `200 replayed`. Prices come from the price list only; no amounts, status or branch can be sent (400).                                                            |
| `POST /opd/bills/:billId/refund-requests`  | `opd.refunds.request`                               | `{ amountPaise, reason, idempotencyKey }`: ask for money back. Any amount up to paid minus refunded minus other open requests. Moves no money. `201` (replay `200`).                                                                                                                                                                                                                                                                                      |
| `POST /opd/visits/:id/cancel-requests`     | `opd.refunds.request`                               | `{ reason, idempotencyKey, amountPaise? }`: ask to cancel a WAITING visit. Default amount: everything still refundable on the consultation bill; 0 keeps the whole fee (a free visit is 0).                                                                                                                                                                                                                                                               |
| `GET /opd/refund-requests?status=&page=`   | `opd.billing.read`                                  | Requests of the branch, newest first (`status` REQUESTED, APPROVED, REJECTED; anything else is 400).                                                                                                                                                                                                                                                                                                                                                      |
| `GET /opd/refund-requests/:id`             | `opd.billing.read`                                  | One request: type, status, amount, reason, bill (with `refundablePaise`), visit, patient, who asked, who decided, note, `refundNumber`, `refunds[]` (mode, amount, reference).                                                                                                                                                                                                                                                                            |
| `POST /opd/refund-requests/:id/approve`    | `opd.refunds.approve`                               | `{ references?: { UPI: "..." }, note? }`. Writes the refunds in the ORIGINAL payment modes (latest payment first), issues the refund voucher number, and for a cancellation cancels the visit. Never the person who asked (`403 SELF_APPROVAL_FORBIDDEN`). Same Admin again: `200 replayed`; another Admin or a decided request: `409 REQUEST_ALREADY_DECIDED`.                                                                                           |
| `POST /opd/refund-requests/:id/reject`     | `opd.refunds.approve`                               | `{ note }` (required). Nothing moves.                                                                                                                                                                                                                                                                                                                                                                                                                     |

Error codes (all new in 6a): `ORDERS_NOT_AVAILABLE` 409 (a test already billed, declined, removed, or of another visit), `VISIT_NOT_BILLABLE` 409, `FEE_NOT_CONFIGURED` 409 (`what: INVESTIGATION`), `PRICE_CHANGED` 409, `TAX_NOT_SUPPORTED` 501, `BILL_NOT_FOUND` 404, `REFUND_REQUEST_NOT_FOUND` 404, `REFUND_REQUEST_OPEN` 409 (a cancellation is already open), `REFUND_EXCEEDS_REFUNDABLE` 409 (`refundablePaise`, `pendingPaise`), `CONSULTATION_STARTED` 409, `VISIT_NOT_WAITING` 409, `REASON_REQUIRED` 400, `REFERENCE_REQUIRED` 400 (`paymentModeCode`), `REFERENCE_INVALID` 400, `RULE_REFUSED` 409 (a database rule refused a race), `NUMBER_SERIES_NOT_CONFIGURED` 409 (`series: REFUND`).

Rules: no refund of the consultation bill once the consultation has started (asking is refused; an older open request can no longer be approved, only rejected); the tests bill can still be refunded afterwards. Approving cancels the visit and takes its token out of the queue. The original bill, receipt and payments are never changed: `bill.refundedPaise` grows and a `REFUND` ledger row is written. Details: `docs/decisions-6a.md`.

## Step 7: collection report and print templates

All routes need a hospital token. Branch, hospital and user come only from the token. Money is integer paise in JSON; the CSV has rupees.

| Route                                   | Permission                        | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /opd/reports/daily-collection`     | `opd.reports.read` (OPD module)   | `?date=YYYY-MM-DD` (hospital time zone day, not in the future, not before 2020) and optional `branch=ALL` (hospital-wide access only, else `403 REPORT_SCOPE_FORBIDDEN`). Returns `totals`, `counts { visits, visitsCancelled, bills }`, `byMode`, `byDoctor`, `byBillType`, `byBranch` (when combined), each row `{ key, name, payments, refunds, collectedPaise, refundedPaise, netPaise, visits? }`, `branches`, `timezone`, and `ledger { paymentPaise, refundPaise, matches }`. Refunds are separate; a refund counts on the day it was approved. Bad input: `400 REPORT_DATE_INVALID` or a validation `400`. |
| `GET /opd/reports/daily-collection.csv` | `opd.reports.read`                | The same report as one flat CSV (`attachment`, UTF-8 with mark, amounts in rupees, formula-safe text, totals only: no patient data). File name `collection-<date>[-all].csv`.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /print-templates`                  | any signed-in hospital staff      | The template of each document (REGISTRATION_SLIP, RECEIPT, PRESCRIPTION): saved (`source: CUSTOM`) or the built-in default (`DEFAULT`), with the real page size `pageWidthMm` and `pageHeightMm`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GET /print-templates/:docType`         | any signed-in hospital staff      | One document's template. `400 PRINT_DOC_TYPE_INVALID` for anything but the three names (exact capitals).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /print-templates/presets`          | `hospital.settings.read`          | The four built-in presets (A4_FULL, A5_FULL, LABEL_SLIP, PREPRINTED_BILL) and what each gives every document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUT /print-templates/:docType`         | `opd.settings.write` (OPD module) | Replaces the template: `{ enabled?, preset?, paper, widthMm?, heightMm?, orientation, margins { topMm, rightMm, bottomMm, leftMm }, mode, layout { fontSizePt, headerText?, footerText?, showLogo?, fields?, offset?, positions? } }`. Millimetres with one decimal at most. Refused with `400 PRINT_TEMPLATE_INVALID { field, reason }`.                                                                                                                                                                                                                                                                          |
| `DELETE /print-templates/:docType`      | `opd.settings.write` (OPD module) | Goes back to the built-in default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Template rules: A4, A5 and A6 have no width or height of their own; LABEL and CUSTOM must have both (20 to 1000 mm); margins 0 to 100 mm and must leave 20 mm to print each way; `positions` only with mode PREPRINTED; `fields` keys must belong to the document (the prescription also accepts `doctorQualifications`, `doctorSpeciality`, `doctorRegistrationNo`, `doctorSignature` for the doctor profile step). Details: `docs/decisions-7.md`.

**Step 7 follow-up (report sections and Excel).** `GET /opd/reports/daily-collection` also returns `byDepartment` (the doctor's department, `(none)` when empty) and `byTest` (`{ key, name, count, billedPaise }`: tests billed that day, not money collected). The CSV and the new `GET /opd/reports/daily-collection.xlsx` (Summary sheet plus one sheet per section) take an optional `sections=MODE,DOCTOR,DEPARTMENT,BILL_TYPE,TEST,BRANCH` (known names, comma separated, once each; `400` otherwise; omitted means all). The CSV has two more columns at the end (`tests_billed`, `billed_rupees`). Same permission (`opd.reports.read`) and audit (`OPD_REPORT_EXPORT`) for both files.

**Step 7-5 (print designer): the template layout is now version 2, boxes.** `PUT /print-templates/:docType` takes `layout: { version: 2, fontSizePt, offset: { xMm, yMm }, elements: [ ... ] }`. A box: `{ id, type: FIELD|TEXT|LINE|IMAGE, xMm, yMm, widthMm, heightMm }` plus `field` and `caption` (FIELD), `text` (TEXT), `slot: 'LOGO'` (IMAGE), and for FIELD and TEXT the style `fontSizePt` (6 to 72), `bold`, `italic`, `underline`, `align` (LEFT|CENTER|RIGHT), `font` (SANS|SERIF|MONO), `tone` (BLACK|GREY); a LINE has `tone`. At most 40 boxes, each wholly on the page, ids `A-Za-z0-9_-` up to 40 characters and unique. New reasons: `OUT_OF_PAGE`, `BAD_ID`, `DUPLICATE_ID`, `UNKNOWN_TYPE`, `UNKNOWN_SLOT`, `UNKNOWN_ALIGN`, `UNKNOWN_FONT`, `UNKNOWN_TONE`, `REQUIRED`, `NOT_A_LIST`, `TOO_MANY`, `TOO_LARGE`. Every document also has the value `hospitalName`. A version 1 layout (`fields`, `positions`, `headerText`, `footerText`, `showLogo`) is still accepted, and stored and answered as version 2.

**Step 7 follow-up (filters).** `GET /opd/reports/filters` (`opd.reports.read`) returns `{ doctors, paymentModes, departments, billTypes, tests, branches }` for the dropdowns. `daily-collection`, `.csv` and `.xlsx` accept `doctor`, `paymentMode`, `department` (use `(none)` for no department), `billType`, `test` and `branch` (`ALL` or a branch id the caller holds the permission in; otherwise `403 REPORT_SCOPE_FORBIDDEN`). One value per filter; an unknown or other-hospital value gives `400 REPORT_FILTER_INVALID`. The answer echoes `filters`, and `ledger.matches` is `null` while a filter is on.

**Step 7-5 (rich text): the template layout is now version 3.** `PUT /print-templates/:docType` takes `layout: { version: 3, fontSizePt, offset, elements }`. Boxes: `RICH` (`content: { paragraphs: [{ align?, runs: [{ t: 'text', text } | { t: 'field', field }, style?: { size, bold, italic, underline, font, tone }] }] }`), `LINE` (`tone`) and `IMAGE` (`slot: 'LOGO'`). Same geometry rules, at most 40 boxes and 15000 characters of text. Version 1 and 2 layouts are accepted and answered as version 3.

**Step 7b (settings screens).** Routes under `/settings` (hospital from the token; every body is checked field by field; a refusal is `400 SETTINGS_INVALID { field, reason }`, an unknown id `404 SETTINGS_NOT_FOUND`). `GET` needs `hospital.settings.read`; writes need `hospital.settings.write`, except the OPD rules which need `opd.settings.write` (OPD module).

- `GET|PUT /settings/opd-rules`: `{ followUpFreeDays (0..365), repeatVisitFreeHours (0..8760) }` plus `persisted`, `limits`. Reason `OUT_OF_RANGE`.
- `GET /settings/patient-fields`: `{ builtin[], custom[], limits }`. `PUT /settings/patient-fields/builtin/:key { isEnabled?, isRequired? }` (reason `LOCKED` for always-on fields). `POST /settings/patient-fields/custom { label, dataType: TEXT|NUMBER|DATE|DROPDOWN, section?, isRequired?, options? }`; `PATCH .../custom/:id { label?, section?, isEnabled?, isRequired? }`; `PUT .../custom/:id/options { options: [{ id?, label, isActive? }] }` (choices left out are switched off, never deleted; at least one must stay on). Reasons: `REQUIRED`, `INVALID`, `TOO_LONG`, `TOO_MANY`, `DUPLICATE`, `NOT_A_DROPDOWN`, `NEEDS_AN_OPTION`.
- `GET /settings/uhid-format`: `{ configured, effectiveFrom, format { resetRule, fyStartMonth, blocks[] }, example, next, branchCode, limits }`. `POST /settings/uhid-format { resetRule: NEVER|FINANCIAL_YEAR, fyStartMonth?, blocks: [{ blockType, textValue?, fyStyle?, minWidth? }] }` starts a new format from now on; the answer is the new `GET`. Reasons add `NEEDS_RUNNING_NUMBER`, `NEEDS_FINANCIAL_YEAR`.
- Audit actions (field names only): `OPD_RULES_CHANGE`, `PATIENT_FIELD_SETTING_CHANGE`, `UHID_FORMAT_CHANGE`.

**Step 7c (doctor profiles).** Routes under `/doctor-profiles` (OPD module; hospital and user from the token; a refusal is `400 SETTINGS_INVALID { field, reason }`, a doctor outside the caller scope `404 SETTINGS_NOT_FOUND`).

- `GET /doctor-profiles/me` and `PUT /doctor-profiles/me` need `opd.doctors.own`: the profile of the signed-in doctor (`id, code, name, printedName, printName, department, qualifications, speciality, registrationNo, active, branches[], missing[], limits`). The body may carry `printedName`, `qualifications`, `speciality`, `registrationNo` (empty text or `null` clears); `department` gives `NOT_ALLOWED`. No active profile: `403 DOCTOR_PROFILE_REQUIRED`.
- `GET /doctor-profiles` needs `opd.doctors.read`: `{ items[], limits, canWrite }`. A hospital-wide Admin sees every doctor; a Branch Admin only doctors with an active membership in a branch where they hold the permission.
- `PUT /doctor-profiles/:id` needs `opd.doctors.write`: the same fields plus `department`; same scope rule.
- Limits: printed name 80, qualifications 150, speciality 80, registration number 40 (letters, digits, spaces and `. / ( ) , -`), department 100. Audit `DOCTOR_PROFILE_CHANGE` (field names and `self`).
- `GET /opd/visits/:id/consultation` and `POST /opd/visits/:id/complete` also return `doctorDetails { name, printedName, printName, department, qualifications, speciality, registrationNo, fromCompletedCopy }`: for a COMPLETED note the copy taken by the database at completion, otherwise the profile as it is now.
