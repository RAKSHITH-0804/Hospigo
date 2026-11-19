# Decisions, Step 6a (tests ordered by the doctor, investigations bill, refunds, cancelling a visit)

API and migration only. The screens are Step 6b. Branch `feature/phase2-step-6a-investigations-refunds-api` (made from `docs/phase2-step5-closeout`, so the closeout docs travel with this PR). One new migration: `20261121090000_investigations_and_refunds` (new, because the 5a migrations are pushed).

## Answers from Rakshith (planning, 19 Nov)

1. **Doctor ordering tests is part of 6a** (UC-08 and UC-09 described it, Step 5 never built it). Small list in the consultation that feeds the reception "pending tests" list.
2. **A refund can be any amount** up to what was paid and not yet refunded (so one test not taken can be refunded alone).
3. **Only an Admin approves.** Receptionists ask, never approve. We also added "the asker never decides their own request" (database rule), cheap and it closes the classic gap if a hospital gives one person both permissions.

## What was built

- **Migration (3 tables, 3 enums, one unique index, 5 functions, triggers):**
  - `investigation_orders`: a test ordered for a visit. `ORDERED` then `BILLED` (points to its bill line) or `NOT_TAKEN` (with a reason). Created only by the visit's own doctor, only while the visit is `IN_CONSULTATION`, only for an active test of the hospital's list (code and name copied). One order per test per visit. Only an `ORDERED` row of a visit still in consultation can be deleted (the doctor changes their mind).
  - `refund_requests`: `REFUND` (money back on one bill) or `CANCEL_VISIT` (cancel a WAITING visit and return its fee; may be 0 for a free visit). Status `REQUESTED`, `APPROVED`, `REJECTED`; who asked, who decided, when, why, the decision note and the refund voucher number (only when money is returned).
  - `refunds`: append-only, one row per ORIGINAL payment returned, in that payment's mode. Writes its own `REFUND` ledger row; the ledger trigger recalculates `bills.refunded_paise` (bills are never edited).
  - `payments` gets a unique index `(tenant, id, bill)` so a refund must point to a payment of the same bill.
- **Database guarantees (so an API bug cannot break them):** bill locked first (two approvals at once cannot return the money twice); refund never more than the bill's paid minus refunded and never more than that payment received; open requests count against what is left; **no refund of a consultation bill once `consultation_started_at` is set**; refund in the original mode (UPI needs its reference); the person who asked can never decide; a decided request never changes; at commit an approved request equals the sum of its refunds, and an approved cancellation leaves the visit `CANCELLED`; **a WAITING visit can only become CANCELLED through an approved cancellation request** (the visit guard is extended); an investigations bill needs a visit that is IN_CONSULTATION or COMPLETED; every line of it must be a test the doctor ordered and a test line never sits on a consultation bill. Forced row level security on all three tables, no grants for `hospigo_hq` / `hospigo_patient`.
- **Permissions (4 new, deny by default):** `opd.investigations.order` (doctor), `opd.investigations.bill` (receptionist, sees pending tests and bills them), `opd.refunds.request` (receptionist, asks for a refund or a cancellation), `opd.refunds.approve` (Admin). The system admin roles get ONLY `opd.refunds.approve`; the other three are in `ADMIN_EXCLUDED_PERMISSION_CODES`. The dev seed gives the Receptionist the bill and request codes and the Doctor the order code. After pulling: migrate, then **re-run the dev seed**.
- **API (new modules `opd-investigations` and `opd-refunds`):** see `docs/api-opd.md` ("Step 6a"). Doctor: search tests, replace the list of tests of the visit. Reception: pending list with current prices, bill tests (split payment, ONE receipt, idempotency key, expected total), mark tests not taken, ask for a refund, ask to cancel. Admin: list, approve, reject.
- **Shared code:** the split-payment planning, the "same payment lines" replay check and the number allocation moved out of the visit service into `opd-visits/billing-helpers.ts` (behaviour unchanged, the visit service now calls it). `toBillView` and the bill include are exported.

## Decisions made while building (not in the plan)

- **Allocation of a refund across payments:** latest payment first (payments of one bill are created in one transaction, so "latest" is the last line). A refund of the full bill returns each payment exactly. If a UPI part is involved the Admin must give its reference (`references: { UPI: "..." }` in the approve call); a missing one is `400 REFERENCE_REQUIRED` (the request stays open and no number is used).
- **Refund voucher number:** its own series (`REFUND`, already configured in the demo seed), taken at approval on the same transaction (a failed approval leaves no gap). A cancellation that returns nothing needs no number.
- **A plain `REFUND` request does not cancel the visit.** To cancel, use the cancel request. The receptionist may keep part of the fee (a smaller amount, or 0).
- **Tests bills can be refunded after the consultation started** (a test not taken after payment, UC-12). Only the consultation bill is blocked by "no refund once the consultation has started".
- **Only a doctor with a doctor profile orders;** a visit of another doctor is "not found". The doctor can replace tests that are still only ordered; tests already billed or marked not taken stay.
- **Billing needs `opd.billing.collect` as well** (same as taking the consultation fee), so the cash permission stays one separate decision. Prices come only from the price list; the request can carry `expectedTotalPaise` for the 409 `PRICE_CHANGED` safety check.
- **Not used in 6a:** the `CHARGE_REVERSAL` ledger type (every visit is billed and paid in one step, so there is nothing unpaid to reverse). It stays in the database for later.
- **A database refusal that wins a race becomes a clean `409 RULE_REFUSED`** (never a 500). Example: the doctor starts the consultation at the very moment an Admin approves a refund of its fee.
- **Audit stores field names, ids, amounts, counts and codes only.** Test names, reasons, notes and reference numbers are never in the audit trail.
- **Existing test changed on purpose:** `opd-visits.endpoints.spec.ts` "a cancelled earlier visit does not give a free one" used to cancel a waiting visit with plain SQL; that is now refused by design, so the test cancels it through an approved cancellation request (same assertion). The admin-roles test was extended (new codes), nothing weakened.

## Click path

Postman collection `postman/collections/hospigo-6a-investigations-refunds.postman_collection.json` (git-ignored, 63 requests with checks). Before running: `npm run prisma:migrate -w @hospigo/api`, then `NODE_ENV=development npm run prisma:seed -w @hospigo/api`, start the API, pick the Hospigo Local environment (`staffPassword` and `superadminPassword`), Run collection. About 5 logins count against the login IP limit.

## Not in 6a

Any screen (6b), lab results, discounts, editing a bill, a printed refund voucher (Step 7), cancelling an unpaid visit (none exists: a visit is billed and paid in one step), registration fee voiding when a first visit is cancelled (the fee is kept; see follow-ups), reports (Step 7).

## Follow-ups noticed, not fixed

- Cancelling a first visit refunds the consultation bill, which includes the registration fee line; the `patient_registration_fees` record stays (the patient is registered). Rakshith to confirm with the hospital whether the registration fee is ever returned.
- Doctor cannot add a test after completing the consultation (an addendum-style "extra test" is not built).
- An Admin cannot edit the amount when approving (approve exactly as asked or reject and ask again). Deliberate: the request stays an honest record.
- Reception sees refund requests of the whole branch (names and UHID), like the visit list. Confirm with the manager.
