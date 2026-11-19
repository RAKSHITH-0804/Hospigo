# Future: LAB and PHARMACY (Phase 3, after the first OPD release)

Written 20 Nov 2026 from Rakshith's requirements. Nothing here is built. It exists so a new session does not lose it. **Goal: paperless.** The patient carries nothing: tests and prescriptions travel inside the system.

## 1. LAB (the laboratory department)

1. When the patient **pays for the selected tests at reception**, the tests reach the lab **with details** (patient, doctor, branch, which tests).
2. The lab person opens the assigned tests, **enters the required result fields**, and the result **reaches the doctor who ordered the test**.

**What already exists (Step 6a/6b):** `investigation_orders` is created by the doctor. A test order becomes **BILLED only after payment** (the database guarantees it), so the lab can only ever see paid tests. The order records the ordering doctor, visit, branch and test. The doctor's Tests box already shows any status it does not know as a neutral label, so "Result ready" can be added without rework.

**What the LAB step adds:**

- Own module and permissions (suggested: `lab.orders.read`, `lab.results.write`, `lab.results.release`); the `LAB` module code already exists in the module list.
- A work queue for the lab person, filled automatically when an order becomes BILLED (a new table linked to the order, not new values in the OPD enum).
- **Test definitions:** the fields, units and normal ranges per test (could arrive with the Excel upload of masters, Step 8b style).
- **Result entry:** append-only and audited; a correction is a new version with a reason (like vitals). A release step (who confirmed the result).
- **The result reaches the ordering doctor:** a "Result ready" mark in their Tests box and a read-only view in the consultation and visit record; access audited (DPDP).
- **Refund rule to add:** today a tests bill can be refunded at any time. Once the lab exists there must be **no refund after the sample is collected** (same idea as "no refund after the consultation started"), as a database rule.

**Decisions needed from management:** who collects the sample (and whether a "sample collected" step exists); outsourced tests; critical values and who is told; how the patient receives the report (patient login, WhatsApp, print); lab department per branch or shared.

## 2. PHARMACY

1. When the doctor writes and saves the prescription it **reaches the pharmacy of the hospital**; the patient carries no paper.
2. The pharmacist **checks the stock**, **hands over the medicines** and **collects the money**. **Billing comes for pharmacy too.**
3. **Later:** the doctor also sees the **medicine stock** (agreed: only "In stock / Low / Out of stock" in the medicine picker, not quantities or batches).

**Decided (20 Nov):** the prescription reaches the pharmacy **when the doctor completes the consultation** (it is frozen then), **not** on every draft save (the draft auto-saves every few seconds and must never be dispensed half written). If the doctor later adds an **addendum** correcting the prescription, the pharmacy is told.

**What already exists:** `prescription_items` (listed medicine from the master or free text flagged "unlisted"), frozen with the completed note; the `PHARMACY` module code.

**What the PHARMACY step adds:**

- A **pharmacy bill** (a new bill type with its own payment, split payment and receipt, using the same money rules: integer paise, append-only, ledger by trigger) and a returns/refund path. **Tax/GST is needed for medicines**: the tax decision is still pending with management.
- **Stock:** batches, expiry dates, quantities, and an append-only **stock movement log** (stock is never edited, only moved by purchases/receipts, dispensing and returns), like the money ledger.
- **Dispensing:** full or partial, with the stock check; the pharmacist maps an "unlisted" free-text medicine to a stock item.
- Own permissions and screens (pharmacy queue of completed prescriptions, dispense and bill, stock).
- Later: doctor stock hint (item 3 above).

**Decisions needed from management:** the stock source and purchases (does the product also manage purchases/suppliers?); GST rules; whether the pharmacy is a separate counter with its own cash; what happens when the patient buys outside (a patient-facing digital copy of the prescription through the patient login); substitution rules.

## 3. Where this fits

LAB and PHARMACY come after Phase 2 (steps 6b, 7, 7b, 8a, 8b, 9). Do not reorder without Rakshith. Both reuse the 6a ideas: a work item created automatically from a paid or completed record, database rules for who may change what, append-only history, forced row level security by hospital.
