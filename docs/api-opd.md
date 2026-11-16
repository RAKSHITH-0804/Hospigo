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

**Query:** optional `sort` = `newest` | `oldest` | `name_asc` | `name_desc` (default `newest`); optional `page`, `pageSize` (same cap as search: `PATIENT_SEARCH_MAX_PAGE_SIZE`); optional at most one of `uhid`, `phone`, `name` (same normalisation / min-name rules as search); **or** optional free-text `q` (trimmed, max `PATIENT_LIST_Q_MAX_LENGTH`). `q` cannot be combined with `uhid` / `phone` / `name`. No filter = list all active patients.

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
