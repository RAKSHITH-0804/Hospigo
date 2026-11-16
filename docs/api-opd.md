# OPD API reference

Fake data only. Grows with each OPD step.

## Permissions

| Code                      | Used by                        |
| ------------------------- | ------------------------------ |
| `patients.registry.read`  | form-config, search, detail    |
| `patients.registry.write` | register, update               |
| `hospital.settings.write` | UHID start-number (raise-only) |

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
      "sortOrder": 0
    },
    {
      "code": "title",
      "label": "Title",
      "dataType": "DROPDOWN",
      "required": false,
      "sortOrder": 100,
      "options": [{ "id": "clx…", "label": "Mr", "sortOrder": 0 }]
    }
  ]
}
```

`name` is always present and required.

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

Alternative to `dateOfBirth`: `ageYears` (integer) → estimated DOB in hospital timezone, `dobIsEstimated: true`. Sending both → `400`.

Phone (when present) must be a valid Indian mobile; stored as `+91XXXXXXXXXX`. Required only when the hospital field setting says so.

**Response 200/201**

```json
{ "id": "clxpatient01", "uhid": "NREG0001" }
```

Audit `PATIENT_REGISTER` with metadata `{ uhid, branchId }` only.

**Errors**

| Status | Code / meaning                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 400    | Validation / required field / both age and DOB / invalid phone                                                               |
| 409    | `{ "statusCode": 409, "code": "POSSIBLE_DUPLICATE", "matches": [{ "id", "uhid", "name" }] }` unless `confirmDuplicate: true` |

---

## PATCH /patients/:id

**Permission:** `patients.registry.write` (+ OPD module)

Partial update of the same fields as register. Sending `uhid`, `tenantId`, or `registeredBranchId` → `400`. Database trigger also refuses mutating `uhid` / `registered_branch_id`.

Audit `PATIENT_UPDATE` with metadata `{ changedFields: [...] }` only (no old/new values).

---

## PUT /patients/uhid/start-number

**Permission:** `hospital.settings.write` (no OPD module gate)

**Request**

```json
{ "startNumber": 5000, "reason": "Skip imported block" }
```

Maps to `UhidService.setStartNumber({ periodYear: 0, nextNumber: startNumber, reason, actorUserId })` — raise-only on the NEVER counter. Existing audit `UHID_SET_START_NUMBER` unchanged.

**Errors:** `400` if decrease attempted or reason empty; `403` without permission.

---

## Auth refusals (all routes above)

| Caller                            | Typical status |
| --------------------------------- | -------------- |
| No token                          | 401            |
| Patient / HQ token (wrong kind)   | 401            |
| Hospital token without permission | 403            |
