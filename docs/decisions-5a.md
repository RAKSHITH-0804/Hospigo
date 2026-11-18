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
