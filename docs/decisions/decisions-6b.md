# Decisions, Step 6b (tests and refunds on the screens)

Web only. No API change, no migration, no new permission code (all of that was 6a, see `docs/decisions/decisions-6a.md`). Branch `feature/phase2-step-6b-tests-refunds-web`, made from the committed 6a branch (commit c819fa6).

## Answers from Rakshith (planning, 20 Nov)

- 6a is committed first, 6b branches from it (two reviews, two PRs).
- Admin finds refund requests through a **tab strip on the OPD pages** (not a separate sidebar item).
- The pharmacy receives a prescription **when the doctor completes the consultation**, not on every draft save. LAB and PHARMACY are Phase 3: `docs/plans/future-lab-pharmacy.md`.

## What was built

- **Doctor, consultation screen:** a **Tests** box under the prescription. Search over the tests list (no prices), chips with a status word, remove only while a test is still just ordered. The list is saved **together with the note by the same auto-save** (one save line, one "Save draft", one "Complete"), and "Complete" saves the tests first, so a test added a second before completing is never lost. After completion the box is read-only with statuses. Hidden for staff without `opd.investigations.order`.
- **Reception, "Tests to bill" (`/app/opd/tests`):** patients with tests ordered and not yet billed (token, patient, doctor, tests). Open one: each test ticked with its current price, a reason box for a test that is unticked (not taken), the total, and the same **payment box as New visit** (one row, or a split such as UPI + cash, ONE receipt). Refreshes by itself (`WEB_OPD_PENDING_REFRESH_SECONDS`, default 20, 0 = off, skipped while the tab is hidden) and on a button.
- **Receipt of a tests bill:** `/app/opd/visits/[id]/tests/[billId]/receipt` reuses the existing receipt print view (each test named on its line, no consultation token).
- **Reception, tests of one visit (`/app/opd/visits/[id]/tests`):** orders with their status, the tests bills with Print receipt and **Request refund**.
- **Reception, requests:** **Request refund** (Bills tab, tests page) and **Cancel visit** (Visits tab, only while the visit is WAITING) open a small inline form: amount (filled with the most that can be returned; for a cancellation 0 is allowed), reason. It only ASKS.
- **Admin, "Refund requests" (`/app/opd/refunds`):** filters Open, Approved, Rejected, All (plain links, server rendered, paged with `WEB_OPD_REFUNDS_PAGE_SIZE`, default 20). Approve (optional note) or Reject (note required). When a payment mode such as UPI needs a reference, the API says which and the screen asks for it, then approves again. A decided request shows who decided, the voucher number, each mode returned and the note. Reception opens the same page **read-only** to follow their own requests.
- **OPD tab strip** (Queue, Tests to bill, Refund requests): each section only for staff who may use it; shown only on those three top-level pages, never on a consultation, vitals or receipt page; an Admin who cannot use the queue is offered Refund requests from the page they land on.
- **11 Next route handlers** under `/api/staff/opd/...` for the new API routes (JSON 401/403, never a redirect; same-origin, JSON-only, object-only bodies; writes go through the stale-tab branch guard). The proxy now also passes on the small facts a refusal needs (`paymentModeCode`, `status`, `series`, `refundablePaise`, `pendingPaise`, `max`).
- **Shared:** `lib/opd/tests-types.ts`, `tests-client.ts`, `tests-draft.ts` (the doctor's list and the merge of the server answer), `tests-billing.ts` (what is billed, declined or left alone, all in paise), `tests-labels.ts` (status words), `use-payment-rows.ts` (payment rows for the new screen), all text in `staffCopy.opd.tests` and `staffCopy.opd.errors`, settings in `config/opd.ts`.

## Decisions made while building (not in the plan)

- **Tests save with the note, not on their own** (one auto-save, one flush on Complete). The save merges the server answer into what is on screen without undoing newer typing (a test just added stays, one just removed does not come back).
- **A status this screen does not know is shown as a neutral label** ("In progress"), never an error. This is the provision for the lab step ("Result ready").
- **A test with no price set cannot be billed:** it is shown with "Price not set. Ask an administrator.", cannot be ticked, and is left on the list (neither billed nor declined).
- **Free tests (price 0)** can be billed: no payment box, no payments sent.
- **The tests receipt names each test** ("Investigation · Blood test"). The receipt component now shows the description on investigation lines (consultation and registration lines unchanged).
- **A message stays until the receptionist acts.** A price that changed reloads the list and the total; the refusal text is kept on screen (a first version cleared it with the reload).
- **Request refund is offered only where it can work:** on the Bills tab only for a WAITING visit with something left to return (after the consultation started the fee cannot be refunded); on the tests page for any tests bill with something left. The API still decides.
- **The Admin's own requests:** the Approve and Reject buttons are replaced by a sentence ("another Admin must decide"), using the signed-in user id (the API refuses it anyway).
- **No exact copy of the "waiting for an Admin" state after a reload:** the inline form says "Request sent" until the page is reloaded; the Refund requests page is the permanent view. Asking twice is stopped by the API (open requests count against what is left; one open cancellation per visit).
- **Existing tests changed on purpose (behaviour changed):** `patients-pages.spec` (the patient record page now passes two more permission flags). Nothing else weakened or removed.

## Click path (Rakshith proves it)

Needs the 6a migration and the re-run dev seed (`NODE_ENV=development npm run prisma:seed -w @hospigo/api`) so the roles hold the new permissions. Start the API and web, open `http://127.0.0.1:3001`, log in yourself (access code `demo-north-main`, passwords from `.env`).

1. **receptionist1:** Patients, a patient, New visit, Doctor North 2, Take cash. (Visit is WAITING.)
2. **doctor2:** OPD queue, Open the patient, **Start consultation**. In the **Tests** box type "Mock", click two tests. After about 5 seconds the save line says Saved. (Reload the page: the two tests are still there.)
3. **receptionist1:** the OPD pages now show the strip **Queue, Tests to bill, Refund requests**. Open **Tests to bill**: the patient is listed. Click **Bill tests**: both ticked at ₹250.00, total ₹500.00. Untick one: a reason box appears and the button stays grey until you write a reason; the total drops. Click **Take cash**. You see "Tests billed" with **Print receipt** (opens the receipt with the test name on its line).
4. **doctor2:** reload the consultation: the billed test says **Billed**, the declined one says **Not taken: <reason>** and cannot be removed.
5. **receptionist1, refund of the tests bill:** Patients, the patient, Visits tab: the visit shows **Tests**. Open it, click **Request refund** on the bill, leave the amount, write a reason, **Send request**. A line says an Admin will decide.
6. **Admin** (`branchadmin@demo-north.example.test` or `superadmin@...`): **OPD queue** shows the strip with **Refund requests**. Open it: the request is listed. Click **Approve**, then **Approve and return**. If the bill was paid with UPI the screen asks for the UPI reference; type one and approve again. The row shows Approved, the voucher number and what was returned in each payment mode.
7. **Cancel a waiting visit:** receptionist makes another visit (stays WAITING). Patient, Visits tab, **Cancel visit**, reason, send. Admin approves. The visit becomes Cancelled and leaves the doctor's queue.
8. **No refund after the consultation started:** on the patient's Bills tab a visit that is in consultation has no Request refund button.
9. **Reception** opens **Refund requests**: sees the state of the requests, no buttons.

## Not in 6b

A printed refund voucher (Step 7), any Settings screen (7b), lab results and the pharmacy (`docs/plans/future-lab-pharmacy.md`), recording that a patient declines ALL tests (see follow-ups), editing a bill, adding a test after the note is completed.

## Follow-ups noticed, not fixed

- **A patient who declines every test:** the API needs at least one billed test per request, so the tests stay on the pending list. Needs a small API route ("mark tests not taken") in a later step.
- **The payment-row logic is now in two places** (`new-visit-form.tsx` and `use-payment-rows.ts`). A later clean-up can move the New visit form onto the hook; it was left alone so the older, well-tested form could not break.
- **The refund form sits inside the table cell.** If it feels cramped on a narrow screen a dedicated page or dialog is the next step.
- **Auto-refresh of the Refund requests page** is not built (Admin reloads or filters); add only if Admins ask.
- **Receptionist cannot see which of their patients have an open request without opening Refund requests.** Fine for release 1.
