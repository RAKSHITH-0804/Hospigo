# OPD use cases (release 1)

Status: DRAFT v2, 14 Nov 2026 (second-round answers on follow-up, part payment, tax, emergency, refunds and availability included). Author: Rakshith. Reference workflow: Sukshema Hospital (an example, not the specification). Nanjappa Hospital was only seen as a patient, so nothing here depends on it.

Rule for this document: **hospital-specific things are settings, never code** (fields, fees, number formats, print layouts, payment modes, vitals). Every item marked **UNCONFIRMED** is a default chosen by the developer and must be confirmed before it is built.

All data used during development is **mock data** (patients, doctors, staff, medicines, lab tests, prices). Production starts empty.

---

## 1. Goal

One system for the whole OPD day, paperless: register, bill, queue, vitals, consultation, prescription and investigation bills. Today the reference hospital uses two separate programs (registration and billing in one, doctor assignment, vitals and prescription in another), so the same patient is typed twice.

## 2. Actors and roles

Roles are permission sets with a scope (a branch or the whole hospital), as already built. Starting roles for OPD are editable by the SuperAdmin.

| Actor                 | What they do in OPD                                                             |
| --------------------- | ------------------------------------------------------------------------------- |
| Receptionist          | Search, register, create visits, bill, print, request refunds                   |
| Nurse                 | Record vitals for waiting patients                                              |
| Doctor                | See own queue, consult, write prescription, order tests                         |
| Admin (branch)        | Upload masters, update prices, approve refunds, doctor availability             |
| SuperAdmin (hospital) | All of the above for every branch; enters the last UHID before first use        |
| Indigo HQ             | Creates hospitals and branches, enables the OPD module (no patient data access) |
| Patient               | Signs in on the web (done in Phase 1); OPD screens for patients come later      |

## 3. Numbering (all per hospital, all from settings)

| Series                | Scope                                                             | Format                                                                  | Reset                         |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| UHID                  | Hospital-wide (all branches)                                      | From the UHID format builder (already built)                            | From settings                 |
| Bill / receipt number | Hospital-wide, separate series from UHID                          | Financial-year prefix + running number from settings, e.g. `2627/00001` | Each financial year (setting) |
| Token                 | **Per branch, per day, one continuous series across all doctors** | `T1, T2, T3...`                                                         | Daily                         |

Token example: T1 for Doctor 1, T2 for Doctor 4, T3 for Doctor 2, T4 for Doctor 1. A doctor's queue shows only that doctor's tokens, in payment order. All counters must be safe when two people act at the same moment (no duplicate, no gap on rollback), like the UHID counter.

Dates and times are stored in UTC and shown in IST. The token day changes at **midnight IST** (confirmed).

## 4. Master data (uploaded by Excel, synced by re-upload)

Uploaded by the Admin or SuperAdmin, one file per data type, matched by a unique code per hospital, as a batch with preview, approve, post and undo. Unmatched rows go to the exceptions list. Nothing is deleted: items are deactivated.

| List                                | Notes                                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff and doctors                   | Doctor flag, department; accounts follow the existing activation flow                                                                                                                                                                                                             |
| Fee list                            | Consultation fee **per doctor**, with an override by visit type (new, follow-up); registration fee (first visit only)                                                                                                                                                             |
| Investigation (lab test) price list | Code, name, price                                                                                                                                                                                                                                                                 |
| Medicine list                       | Code, name, composition, form; doctors may also type a free-text medicine (flagged "unlisted")                                                                                                                                                                                    |
| Vitals fields                       | Name, unit, order, active (starting set: pulse, SpO2, blood pressure, respiratory rate, temperature, weight)                                                                                                                                                                      |
| Payment modes                       | Cash, UPI, card (reference number required for non-cash)                                                                                                                                                                                                                          |
| Tax settings                        | Per hospital, **off by default**: tax name, rate(s), registration number printed on receipts, taxable flag per charge item, inclusive or exclusive. Bill lines store the tax amount, so switching it on later needs no data change. The exact rules are decided with the hospital |
| Follow-up window                    | Free follow-up window in days (default 7)                                                                                                                                                                                                                                         |
| Print templates                     | See section 6                                                                                                                                                                                                                                                                     |

**Prices:** only Admin or SuperAdmin change prices. A price change applies to **new bills only**; every bill line stores the price at the time of billing. Old bills never change.

## 5. Use cases

### UC-01 Search patient

- Actor: Receptionist. Goal: find an existing patient in seconds.
- Flow: enter UHID, mobile number or name; the system shows matches hospital-wide (any branch).
- Alternative: one mobile number shared by a family lists every family member; the receptionist picks the right person.
- Alternative: no match, so go to UC-02.
- Rules: results are paginated; the search never shows another hospital's patients.

### UC-02 Register a new patient

- Actor: Receptionist. Before: signed in, OPD enabled for the branch.
- Flow: enter the patient fields configured by the hospital (mandatory ones enforced) and save; the system generates the UHID automatically (never typed); the optional registration slip can be printed.
- Fields seen at the reference hospital: title, name, relation type and relative's name (S/O, W/O), date of birth or age, gender, address lines, mobile, email, referred by, category, organisation, staff number. Relation type and relative's name are stored separately and printed together.
- Alternative: age given without date of birth: allowed.
- Error: duplicate warning when the same mobile, name and date of birth already exist; the receptionist may open the existing patient or continue.
- After: patient exists, audit entry written. Aadhaar is not collected (storage rules not decided).
- Not part of Hospigo's flow: the registration validity date seen in the reference software (dropped).

### UC-03 Update patient details

- Actor: Receptionist (permission-controlled). Flow: open patient, edit, save.
- Rules: the UHID never changes; every change is audit-logged with who, when and old/new value.

### UC-04 Create an OPD visit and assign a doctor

- Actor: Receptionist. Before: patient exists.
- Flow: choose the doctor and the visit type (new or follow-up); the system proposes the bill (UC-05).
- Rules: only doctors marked available (UC-15) can be chosen. Two doctors on the same day means two separate visits, each with its own bill and token.
- Visit type is chosen by the receptionist; most repeat visits are follow-ups.
- **A follow-up within the free window (default 7 days, a setting) is free:** when the receptionist picks follow-up and the patient has a completed visit with the same doctor inside the window, the consultation fee is zero (the visit still gets a bill number and a token). Outside the window the follow-up fee from the fee list applies. UNCONFIRMED: the window counts from the earlier visit date and applies to the same doctor only.
- **Emergency flag:** a receptionist with the permission can mark a visit as Emergency (a reason is required). It enters the doctor's queue before full payment and the amount due is tracked (UC-16). This is only a flag, not the full emergency or MLC workflow (next phase).

### UC-05 Collect charges and issue the receipt

- Actor: Receptionist. The consultation bill is collected when the doctor is assigned, before the consultation.
- Flow: consultation fee (per doctor, by visit type) is shown; the registration fee is added only if this is the patient's first visit at the hospital (any branch, once per patient); the receptionist picks the payment mode; a reference number is required for UPI or card; the system issues the bill/receipt number and the token, and prints the receipt with the token on it.
- Rules: money is stored as integer paise; a bill is never edited or deleted (corrections are reversals, UC-12); no discounts in release 1.
- **Part payment is an exception, not the normal way.** Only a user with the part-payment permission can accept less than the full amount, a reason is required, and the amount due stays on the visit until collected (UC-16). Normal billing needs full payment.
- **Tax:** if the hospital has switched tax on in settings, the receipt shows tax per line and the total; if not, nothing is shown.
- After: the visit joins the doctor's queue in payment order (UC-06).

### UC-06 Token and doctor queue

- The token is issued on payment (branch-wide daily series, section 3).
- The doctor's queue lists only that doctor's visits that are **fully paid, part paid (by exception) or marked Emergency**, in payment order. Zero-fee follow-ups count as paid. A patient with an unpaid visit never appears.
- Part-paid and Emergency visits carry a small badge. UNCONFIRMED: an Emergency visit moves to the top of the queue.

### UC-07 Record vitals

- Actor: Nurse. Flow: see all waiting patients of the branch, filter by doctor, open a visit, enter the configured vitals with their units, save.
- Rules: values are validated against sensible ranges (settings); a correction creates a new version and the old value stays in history; the doctor sees the latest values.

### UC-08 Consultation and prescription

- Actor: Doctor. Flow: open own queue, call the next patient, see the patient summary and vitals, then record complaints, diagnosis, investigations to order (picked from the test list), medicines (from the list or free text, each with dose, frequency, duration and instructions), advice and a follow-up date; save to complete the visit.
- Rules: free-text medicines are flagged "unlisted"; no prescription templates in release 1 (decision); records from other branches are not shown unless shared through the referral or emergency rules already agreed.
- After: the prescription can be printed (UC-10); digital sharing through the patient login comes later.

### UC-09 Investigations bill

- Actor: Receptionist. Flow: tests ordered by the doctor appear automatically on a "pending investigations" list with the patient's name; the receptionist selects the tests the patient will take, the system prices them from the current price list, takes payment (same modes), issues a bill number and prints the bill.
- Alternative: the patient declines some tests; those lines are marked "not taken" with a reason and are not billed.
- Scope: release 1 bills tests only. Running the lab and entering results is a later module.

### UC-10 Print documents

- Documents: registration slip (optional), receipt/bill, prescription, token (on the receipt).
- Every document uses a print template chosen in settings (section 6). Printing goes through the browser print window.

### UC-11 Follow-up visit

- Same flow as UC-04 and UC-05 with visit type "follow-up", linked to the earlier visit; the fee comes from the fee list override (may be zero).

### UC-12 Cancel a visit or refund

- Actor: Receptionist requests, **Admin approves**. Cases: the patient leaves before seeing the doctor, a wrong bill, a test not taken after payment.
- Flow: request with a reason; the Admin approves; the system writes a **reversal entry** and voids the token if the visit was not started; refunds follow the original payment mode.
- Rules: the original bill is never changed; the reversal records who, when and why.
- **No refund once the consultation has started** (confirmed).

### UC-13 Daily collection report

- Actor: Admin, SuperAdmin. Per branch and date: collection by payment mode and by doctor, count of visits, reversals shown separately; the SuperAdmin can combine branches. No day-closing in release 1.

### UC-14 Admin setup

- Upload and sync the lists in section 4 (Excel batches); update prices (with the effective date); set vitals fields, payment modes and print templates.
- The SuperAdmin enters the last UHID once before the hospital starts (raise-only, with a reason, audited).

### UC-15 Doctor availability

- The Admin sets a today's availability switch, weekly timings and leave days for each doctor.
- Rules: a doctor marked unavailable is still listed but shown as **Not Available Now** and cannot be assigned. Timings and leave only warn the receptionist.
- UNCONFIRMED: the developer read "both" as switch plus timings and leave. To be confirmed.

### UC-16 Collect a pending balance

- Actor: Receptionist. Cases: a part-paid visit or an Emergency visit with an amount due.
- Flow: find the visit (a pending-dues list per branch), collect the amount with a payment mode (reference for non-cash); the system issues a receipt number and reduces the amount due. The bill itself is not edited.
- Rules: every payment is its own record against the bill; total paid can never exceed the bill; nothing is deleted.
- Not in release 1: waiving or writing off a balance.

## 6. Printing (settings, not code)

Different hospitals print on different paper (a small label, A5, A4, or pre-printed continuous stationery where only the details are printed into the empty form). So each **document type** has a **print template** chosen in settings, per hospital (per branch if needed):

| Setting                 | Options                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Document on/off         | Registration slip can be switched off completely                                                                                          |
| Paper                   | A4, A5, A6, label (width x height in mm), custom size                                                                                     |
| Orientation and margins | Numbers in settings                                                                                                                       |
| Mode                    | **Full** (Hospigo prints letterhead, logo and boxes) or **Pre-printed** (only the data is printed; position offsets in mm are adjustable) |
| Content                 | Which fields appear, font size, header and footer text, logo                                                                              |

Release 1 ships a few built-in templates (A4 full, A5 full, label slip, pre-printed bill) that settings choose from, with adjustable offsets. A visual template designer is later.

Limits to accept for release 1: the browser print window selects the printer (a website cannot print silently to a chosen printer); a small print helper program can be added later if reception needs one-click printing. **Risk:** printing onto dot-matrix continuous stationery must be tested on the hospital's real printer before go-live.

## 7. Audit and money rules

- Money is integer paise in one ledger; bills, receipts and reversals are never edited or deleted.
- Every create, change, approval and reversal writes an audit entry (who, when, what).
- Bill lines store the price, name and code at the time of billing.
- Staff and master data are deactivated, never hard-deleted.

## 8. Not in release 1

Appointment booking and online booking screens, video consults, pharmacy (the medical store is outside), lab execution and results, IPD, discounts and concessions, insurance and organisation billing, the full emergency and MLC workflow (only the Emergency flag is in), prescription templates, patient-side OPD screens, day-closing, write-off of balances, and the doctors' other daily tools (next phase).

Seen in the reference hospital's current software for later phases: OP edit and discount, IP admission and billing, ward status, result entry, category and organisation on registration.

## 9. Still open (with the default used)

| #   | Question                                                               | Default used                                                          |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Tax or GST: which items are taxable and at what rate?                  | Off by default; the hospital switches it on in settings               |
| 2   | Who may approve a part payment, and is there a limit?                  | Users with the part-payment permission; a reason is required          |
| 3   | Does an Emergency visit go to the top of the queue?                    | Yes, with a badge                                                     |
| 4   | Free follow-up: same doctor only, counted from the earlier visit date? | Yes                                                                   |
| 5   | Which print layouts does each hospital need?                           | Settings decide; the slip is optional (not yet seen by the developer) |
| 6   | The full emergency and MLC workflow                                    | Next phase                                                            |
| 7   | The doctors' other daily tools in the current software                 | Next phase                                                            |

## 10. Decisions confirmed by the developer on 14 Nov 2026

Consultation fee per doctor with visit-type override; registration fee once per patient hospital-wide; bill numbers hospital-wide with a financial-year format; old bills keep old prices and only Admin or SuperAdmin change prices; payment modes cash, UPI, card with a reference for non-cash; no discounts in release 1; two doctors the same day means two visits; token restarts daily per branch as one continuous series; refunds approved by the Admin; queue ordered by payment time; nurses see all waiting patients of the branch; vitals list configurable; medicines by Excel list plus free text; no prescription templates; daily collection report only; starting roles Receptionist, Nurse and Doctor; investigations ordered by the doctor appear automatically at reception; last UHID entered by the SuperAdmin before first use; all development data is mock data.

Second round (14 Nov): a follow-up within 7 days is free (a setting); part payment is a permissioned exception; tax is a hospital setting, off by default; the doctor's queue shows paid, part-paid and Emergency visits; no refund after the consultation starts; an unavailable doctor shows as Not Available Now; the token day resets at midnight IST; the registration validity date is not part of the flow; the doctors' other tools and the full emergency workflow are next phase.
