# Plan: Step 3d and the thinner first OPD flow

Written 17 Nov 2026 on branch `docs/plan-opd-first-flow` (from `develop` at c32185f). **Plan only: nothing is built, nothing is committed.** Waiting for Rakshith's "approved" and answers to section 7.

## 0. Approved (17 Nov 2026) and what changed

Rakshith approved this plan with the answers in section 7 (now decisions) and these changes:

- **New order of Phase 2:** 3d, 4a-1, 4a-2, 4b, 5a, 5b, 6a, 6b, 7, 7b (Settings screens: custom required fields, required-field settings, UHID format creation), 8a, 8b, 9. Nothing in Phase 2 is skipped. This file only plans 3d to 5b; 6a to 9 are planned when we reach them.
- **Step 3d goes first, started 17 Nov.**
- **Target date: Fri 27 Nov 2026. Quality comes first:** tests and review gates are never shortened for time. See the honest estimate in section 4.
- **Self-review at every review gate (new standing rule, also in `CLAUDE.md`):** after code and tests are done, a separate adversarial pass before showing Rakshith (how could it be attacked or break; which attacks the tests cover; tests added for the gaps; plain-words verdict: safe to approve, or needs a decision).
- **Review gates stay:** permissions and tokens, tenant isolation and RLS, anything touching money, migrations, anything that removes a protection. Step 3d stops after the API part for review before the web part is built.

> **Update 18 Nov 2026:** 4a-1 and 4a-2 are merged into one step **4a** (one branch, one PR, two commits). The migration commit comes first and is a mandatory review gate; the API part starts only after Rakshith approves it. Estimates 2.5 + 3.5 days stay as the total for 4a, less about half a day of PR overhead. Doctor also gets `opd.vitals.write` (5a seed). Admin roles get only read permissions for visits and billing (decided in `docs/decisions/decisions-4a.md`).

## 1. Goal in one paragraph

A receptionist registers a patient (already works), creates a visit and picks a doctor, bills the consultation and takes cash. The visit gets a token and appears in that doctor's queue. The doctor opens the patient, writes a short note and completes the visit. Before that, the SuperAdmin can switch branch (Step 3d), so one demo login can see both branches.

## 2. What is cut, and what is kept

| Cut for now (comes later, schema leaves room)                                                                                                                         | Kept without compromise                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Part payments, pending dues list (UC-16)                                                                                                                              | Money in integer paise, bills, bill lines, payments and ledger never edited or deleted |
| Refunds and visit cancel (`bill_reversals`), refund numbers                                                                                                           | Database triggers keep `paid_paise` and status; app role cannot update them            |
| Investigations and pending-tests list                                                                                                                                 | Row level security on every new table; cross-hospital leak tests                       |
| Emergency flag (columns stay in the table, unused)                                                                                                                    | Tenant and branch from the token, never from the request body                          |
| Print templates (a plain browser print view of the receipt is the only print)                                                                                         | Audit on every write (field names, not personal values)                                |
| Nothing permanent: vitals and prescription are NOT dropped, they are built in 5a/5b after the first bill-to-doctor path (see 5a/5b). Only the follow-up date UI waits | Permission on every route, deny by default, route-scan test                            |
| Non-cash payment modes in the UI (the `payment_modes` master stays)                                                                                                   | Idempotency keys (a double click never bills or charges twice)                         |
| Daily collection report                                                                                                                                               | Gap-free bill, receipt and token numbers; follow-up free window (if answered yes, Q3)  |

## 3. Steps

Order matters: 3d first (small, independent), then money API, then screens.

Estimates are working days for **me coding plus Rakshith testing and reviewing**, assuming no big surprises. They are not calendar promises. Review gates (migration, money, RLS, permissions, token handling) stop and wait for Rakshith, so add his review time.

### Step 3d: SuperAdmin branch switcher (about 1 day)

**What it is.** Today a login is bound to one branch (the access code used). `auth_sessions.branch_id` and the access token both carry the active branch. The SuperAdmin must be able to change the active branch without logging in again.

**Contents**

- API `POST /auth/switch-branch` `{ branchId }`. Allowed only if the user holds a hospital-wide role assignment (SuperAdmin) and the branch is active, in the same hospital, and has a membership or hospital-wide scope. Everyone else gets 403.
- Mechanism: revoke the current session family and issue a new access token and refresh session for the target branch (so a stolen old refresh token cannot move back). Needs a decision on the shape (Q1).
- Audit entry (who, from branch, to branch). Rate limited like refresh.
- Web: branch chip becomes a dropdown only when `/auth/me` says the user may switch; route handler `POST /api/auth/switch-branch` (JSON only, cookies set server side, token never in the browser); page data refreshes after the switch. For everyone else the chip stays read-only.
- Copy in `staff-copy.ts`, no hardcoded text.

**Tests.** SuperAdmin switches and `/auth/me` shows the new branch; Branch Admin and Receptionist get 403; switching to another hospital's branch is refused; a disabled branch is refused; old refresh token is dead after the switch; audit row exists; route-scan test passes; web component tests for chip (read-only vs switcher).

**How Rakshith proves it.** Postman collection "3d branch switch" (login as `superadmin@demo-north...`, switch, check `/auth/me`, 403 checks with the receptionist, cross-hospital check). Browser: log in as SuperAdmin with `demo-north-main`, switch to East branch, the chip and patient registered-branch column follow; log in as the receptionist and see no switcher.

**Review gate:** token handling and permissions. I stop after the plan for this step and after the build.

### Step 4a-1: money and visit tables (migration only) (about 2 days)

**Contents.** One migration, plus Prisma models. Tables: `opd_visits`, `bills`, `bill_lines`, `payments`, `ledger_entries`, `consultations`, and (if Q4 is yes) `patient_registration_fees`. Design is the one already written in `docs/reference/schema-opd.md` sections 5 to 7, trimmed:

- RLS plus FORCE RLS on all, grants to `hospigo_app` as INSERT and SELECT only on append-only tables; no grants for `hospigo_hq` or `hospigo_patient`.
- Append-only triggers on `ledger_entries`, `payments`, `bill_lines`; `bills` may change only the three trigger-maintained columns.
- Ledger trigger maintains `bills.paid_paise` and `payment_status`; `CHECK paid_paise <= total_paise` (two simultaneous payments cannot overpay); `CHECK total = subtotal + tax`.
- Token constraints, one consultation bill per visit, idempotency uniques, counters-only-forward trigger (an open follow-up from the handoff).
- Enums are written in full (all visit statuses, bill and ledger types) so later steps need no enum change. Unused columns (emergency, reversals) stay out where a plain `ADD COLUMN` later is safe; I will say per column in the plan for this step.

**Tests (DB level).** RLS leak tests on each new table; UPDATE and DELETE fail for the app role on append-only tables; paid amount can never exceed total; trigger recalculates status; 50 parallel token, bill and receipt numbers are distinct and gap-free; a rolled-back transaction leaves no gap; HQ and patient roles read nothing.

**How Rakshith proves it.** `npm test -w @hospigo/api` (count goes up, I will report before and after) plus a short SQL checklist in pgAdmin that I write for him (try to update a payment, try to read another hospital).

**Review gate:** migration, money, RLS. Hard stop for his review.

**Migration rule:** per CLAUDE.md, a new migration file is only allowed after the 3c push. I will check `git log origin/develop` before creating it.

### Step 4a-2: visit, bill and cash payment API (about 3 days)

**Contents**

- Permissions (new codes, Q5): create visit, collect payment, read visits and bills.
- `GET /opd/doctors` lists doctors with fee, availability and the "Not Available Now" reason (reuses `doctor-availability.service`). Unavailable doctors cannot be assigned (400).
- `POST /opd/visits` `{ patientId, doctorProfileId, visitType, idempotencyKey }`: creates the visit (AWAITING_PAYMENT) and the consultation bill with its lines in one transaction. Fee from `doctor_fees` by visit type (price at that moment is copied into the line). Free follow-up within the window gives a zero total (Q3). Bill number from the hospital-wide series, on the caller's transaction.
- `POST /opd/bills/:id/payments` `{ paymentModeId, amountPaise, idempotencyKey }`: cash only; amount must equal the amount due (no part payment); receipt number from the series; one ledger row in the same transaction; on full payment the visit becomes WAITING and gets the token (per branch per IST day) and `queued_at`. A zero-total bill is queued at creation.
- `GET /opd/visits/:id` and `GET /patients/:id/visits` (fills the Visits and Bills tabs on the patient record).
- Branch always comes from the token. A patient from another hospital cannot be used (RLS plus a test).
- Audit entries for visit created and payment taken (ids and field names only).
- `docs/reference/api-opd.md` updated.

**Tests.** Cross-hospital refusals; permission refusals per route (route-scan); fee picked correctly per visit type; price change does not alter an old bill; follow-up inside 7 days is free and outside is charged; double submit with the same idempotency key returns the same bill and payment; wrong amount refused; payment on an already paid bill refused; unavailable doctor refused; token resets per IST day and per branch; tokens are consecutive under parallel requests.

**How Rakshith proves it.** Ready-made Postman collection in `postman/` ("4a OPD visit and cash", with checks): login as receptionist, list doctors, create visit, pay, read visit (status WAITING, token 1), repeat the same call (same ids), try wrong amount, try unavailable doctor `doctor1@demo-north`, login as the South receptionist and try the North visit (404).

**Review gate:** money and permissions.

### Step 4b: reception web for visit and billing (about 2 days)

**Contents.** On the patient record page: "New visit" button opens a compact form (doctor list showing fee and availability, visit type), a bill summary (fee, total in rupees from paise by one formatter), "Take cash" button, then a receipt view with bill number, receipt number, token and a plain browser print (`@page` from one config value, same approach as the registration slip). The Visits and Bills tabs list real rows. Route handlers return JSON 401/403, forms are client components, server first paint, skeletons, all text in `staff-copy.ts`, sizes from `globals.css`. A fresh idempotency key per attempt, reused on retry.

**Tests.** Web unit tests for the money formatter, form states, route handlers (401, 403, error mapping), scan tests still pass.

**How Rakshith proves it.** Click path I write exactly (receptionist at `demo-north-main`: open a patient, New visit, pick doctor 2, Take cash, see the receipt and token; open the Visits tab and see the row; try doctor 1 and see "Not Available Now"; double-click Take cash and see only one receipt).

### Step 5a: doctor queue and consultation note API (about 1.5 days)

> **Vitals and prescription are NOT dropped (Q8, 17 Nov).** Nurse vitals (`visit_vitals`, configurable fields, versioned corrections) and the prescription (`prescription_items`: medicines from the Excel list plus free text flagged "unlisted") stay in Steps 5a and 5b. They come after the first bill-to-doctor path and before 6a. The bullets below describe the first slice (queue, start, note, complete, addendum); vitals and prescription are added to 5a in the same step, and the estimate (2.5 days) is re-done in the 5a plan, because it does not yet include them.

**Contents.**

- `GET /opd/queue` for the logged-in doctor (doctor profile found from the user): own WAITING and IN_CONSULTATION visits for the token's branch and today, ordered by `queued_at`, with patient name, age, token.
- `POST /opd/visits/:id/start`: sets IN_CONSULTATION and `consultation_started_at` (this is the moment refunds will later be refused). Only the assigned doctor.
- `PUT /opd/visits/:id/consultation` (draft save) and `POST /opd/visits/:id/complete`: simple note (complaints, diagnosis, advice, optional follow-up date) then status COMPLETED. A completed note is not editable; a correction is an addendum with who, when and why (`consultation_addenda`, Q7). Notes (and addenda) are readable only with the notes permission (Doctor, Nurse) in the branch where the visit happened, each read audited (Q6).
- `GET /opd/visits/:id/consultation` for the doctor, and a read of own patient's last notes (same branch only; no cross-branch history in this flow).
- Audit; permissions; doctor sees only own queue.

**Tests.** Doctor B cannot see or open Doctor A's visit; receptionist cannot read notes, a Nurse of another branch cannot, and every read writes an audit row (Q6); addendum records who, when and why (Q7); unpaid visit never in a queue; queue order by payment time; completed note refuses edits; cross-hospital and cross-branch refusals; route-scan.

**How Rakshith proves it.** Postman collection "5a doctor queue": receptionist creates two visits for doctor 2, doctor 2 logs in, sees both in order, starts the first, saves a note, completes it, queue shows one left; doctor 3 sees an empty queue.

### Step 5b: doctor web (about 2 days)

> **Vitals and prescription are NOT dropped (Q8).** The Nurse screen (waiting patients, enter vitals) and the doctor's medicine rows (list or free text, dose, frequency, duration) are part of 5b. They come after the first bill-to-doctor path and before 6a. The 5b estimate (2 days) is re-done in the 5b plan.

**Contents.** Doctor queue page (replaces the sample-data OPD queue page for the doctor role, no fake numbers), "Start consultation", note form (autosave off, explicit Save and Complete), patient header with age and phone, small read-only list of the patient's previous completed visits in this hospital. Session renewal helper reused. Copy, tokens and scan tests as before.

**How Rakshith proves it.** Click path: log in as `doctor2@demo-north...`, queue shows the tokens the receptionist created, Start, type a note, Complete, the patient leaves the queue; reception Visits tab shows COMPLETED.

### Step E: docs and exit check (about 0.5 day, rolled into each PR where possible)

Update `docs/engineering-tracker.md` (it is stale: it still says 3b in progress and 3c planned), `docs/decisions/decisions-4a.md` (new), `docs/handoff-phase2.md`, `docs/guides/dev-accounts.md` for any new demo permissions, the follow-ups list, and one end-to-end Postman run across all steps (reception to doctor). I will also fix the stale line counts and statuses I noticed in `project-context.md` only if you ask, since this plan was told to edit nothing else.

## 4. Order, size of pull requests, time summary

One feature branch and one PR into `develop` per step (4a-1 and 4a-2 may share one PR only if you prefer; I recommend two because 4a-1 is a review gate).

| Step  | Estimate (working days) | PR                                       |
| ----- | ----------------------- | ---------------------------------------- |
| 3d    | 1.5 (incl. self-review) | `feature/phase2-step-3d-branch-switcher` |
| 4a-1  | 2.5 (Q4 table)          | `feature/phase2-step-4a1`                |
| 4a-2  | 3.5 (Q2, Q3, Q4)        | `feature/phase2-step-4a2`                |
| 4b    | 2                       | `feature/phase2-step-4b`                 |
| 5a    | 2.5 (Q6, Q7)            | `feature/phase2-step-5a`                 |
| 5b    | 2                       | `feature/phase2-step-5b`                 |
| Docs  | 0.5                     | inside each PR                           |
| Total | about 14.5 working days |                                          |

**Honest read (updated 17 Nov).** About 14 to 14.5 working days from 18 Nov (Monday to Saturday, Sunday off) lands around **Wed 2 to Thu 3 December**. **Fri 27 Nov is not realistic for the whole flow** with every test and review gate kept; by 27 Nov I expect 3d, 4a-1, 4a-2 and probably 4b (reception can create visits, bill, take cash and queue), with the doctor side (5a, 5b) following. Rakshith's rule stands: quality first, no shortened tests or gates. The biggest risk is the migration (4a-1): a wrong trigger or RLS policy is slow to find. His review time and the push/PR of each step are not counted. Phase 2 after 5b (6a, 6b, 7, 7b, 8a, 8b, 9) is not estimated yet.

## 5. Risks and things I will not do

- **Will not:** touch MedicoERP; weaken or delete an existing test; hardcode a hospital name, fee, text or size; take the branch or tenant from a request body; edit or delete money rows; push; commit without "commit"; start code before "approved" for each step.
- **Migration timing:** new migration needs the 3c work pushed first.
- **No fix path for a wrong bill** in this thin flow (refunds are cut). For dev it is fine (reseed). Before a real hospital uses it, refunds (Step 6a) must exist. I will say so in the decisions file.
- **Doctor to user link:** `doctor_profiles.user_id` is unique, so a doctor's queue is found from the login. A doctor user with no profile gets an empty queue and a clear message, not an error.
- **Seed permissions:** the dev seed gives Receptionist, Nurse and Doctor roles, but the new permission codes must be added to the Permission catalog and the demo roles. Real hospitals getting these roles is still an open item with management.
- **Time zones:** token day and follow-up window use the hospital timezone from `opd_settings` (Asia/Kolkata), tested around midnight.

## 6. Existing docs I noticed that disagree (not fixed here)

- `docs/engineering-tracker.md` is out of date (3b "In progress", 3c "Planned"; header says 3b).
- `docs/handoff-phase2.md` says `develop` is `6a05dca` and tests are 245/155; `docs/decisions/decisions-3c.md` says 281 API tests. `project-context.md` is newest.
- `docs/decisions/decisions-3c.md` section 1 says "push and PR not yet done" but git shows PR #41 merged.
- `docs/reference/schema-opd.md` lists `print_templates`; Step 2 did not build it (already noted in "As built").
- I did not read `docs/design/ui-design.md`, `docs/reference/api-auth.md` or `docs/reference/system-design.md` in full, only the branch switcher part of the first two. I will read them before 3d.

## 7. Decisions (answers of 17 Nov 2026; the original questions follow below for the record)

| #         | Decision                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1        | Switcher is **SuperAdmin only** (hospital-wide scope) and issues a **new access token per branch**. Mechanism (new session family, old one revoked) as recommended; details in the 3d plan.                                                        |
| Q2        | **Bill and payment stay separate records.** The reception button does visit + bill + payment in **ONE database transaction with an idempotency key**. The API still keeps separate create and pay calls underneath so part payment can come later. |
| Q3        | Free follow-up is a **hospital setting** (`follow_up_free_days`, 7 in the demo seed). A follow-up inside the window makes a **zero-amount bill that counts as settled** for the queue gate.                                                        |
| Q4        | **Registration fee once per patient** is included, as a **bill line item** (`patient_registration_fees` table with the partial unique index).                                                                                                      |
| Q5        | Permission names follow the existing pattern (`patients.registry.read`, `opd.masters.read`). Receptionist, Nurse and Doctor each get only what they need. **The final list is shown in the 4a-1 plan.**                                            |
| Q6        | Consultation notes are readable only by users with the **notes permission** (Doctor, Nurse), **in the branch where the visit happened**; not Receptionist; **every read is audited**.                                                              |
| Q7        | A completed note **cannot be edited**; a correction is an **addendum** (who, when, why).                                                                                                                                                           |
| Q12       | 3d first, new Phase 2 order and target date as in section 0.                                                                                                                                                                                       |
| Q8        | **Vitals and prescription are NOT dropped.** They stay in Steps 5a/5b, after the first bill-to-doctor path and before 6a.                                                                                                                          |
| Q9 to Q11 | My recommendations stand: plain browser-print receipt (Q9), `CASH` mode taken from the `payment_modes` master (Q10), no doctor reassign in this flow (Q11).                                                                                        |

**Effort added by Q3, Q4, Q6, Q7 (my estimate, working days):** Q3 free follow-up about 0.5 (rule, window by IST date, zero-total bill gate, tests around day 7 and day 8); Q4 registration fee about 0.5 to 1 (one table, one unique index, a bill line, a cross-branch test, void rule left for the refunds step); Q6 about 0.5 (notes permission, branch rule, audited reads, Nurse role grant); Q7 about 0.5 (an addendum table and endpoint, "completed is read-only" check). Total about 2 to 2.5 days on top of the base build; section 4 now includes them.

### Original questions (kept for the record)

1. **Switcher shape (3d).** Recommended: a new session family for the target branch (the old one is revoked), because `auth_sessions.branch_id` is one branch per session. Alternative: keep one session and store an "active branch" on it (fewer rows, but changes how refresh works). OK with the recommendation?
2. **One-step or two-step payment.** Recommended: API has two calls (create visit and bill, then pay) so part payment can be added later; the screen runs both with one "Take cash" button, and if payment fails the visit stays "Awaiting payment" with a "Take payment" button. Alternative: one API call that does both and never leaves unpaid visits. Which?
3. **Free follow-up** (inside 7 days, same doctor, zero bill but still a bill number and token): include in this flow? Recommended yes, it is a confirmed rule and the settings already hold the window. (UC-04 marks "same doctor only, counts from the earlier visit date" as unconfirmed; I would use that.)
4. **Registration fee once per patient** (needs the `patient_registration_fees` table and its partial unique index): include now? Recommended yes, because otherwise the first bill amount is wrong and fixing it later changes billed amounts. It costs about half a day. If no, the first flow bills only the consultation fee.
5. **New permission codes.** My proposal: `opd.visits.create`, `opd.visits.read`, `opd.billing.collect`, `opd.queue.read` (doctor), `opd.consultation.write` (doctor). Receptionist gets create, read, collect. Doctor gets queue.read, consultation.write and visits.read for own patients. Branch Admin and SuperAdmin get read. Nurse nothing yet. Do you want different names or grouping?
6. **Who may read consultation notes?** Recommended: only the doctor who wrote it, other doctors of the same hospital for the same patient (read only), and nobody at reception. Alternative: the same doctor only.
7. **Can a completed note be corrected?** Recommended no in this flow (a later step adds addenda with who and when). Alternative: the doctor may edit until end of day.
8. **Nurse and vitals:** (answered: not dropped, built in 5a/5b, see decisions table).
9. **Receipt:** I treat a plain browser print view with bill number, receipt number, token, patient, doctor, line, total, mode as the one print in this flow. Is that acceptable, or should even that wait?
10. **Payment mode:** cash only means the web shows no mode picker and sends the `CASH` mode from the `payment_modes` master. Do both demo hospitals have a `CASH` row in the seed? (I will check; I need to know if the code `CASH` is fixed or a setting.)
11. **Doctor "assign":** is picking the doctor at visit creation enough ("assign" in your message), or do you want a separate reassign action before payment? Recommended: no reassign now.
12. **Order and date.** Do you want 3d first as written, or after the reception billing steps (so the first flow comes sooner)? And is a first working flow around 2 to 3 December acceptable, or is there a fixed date I should plan backwards from?

## 8. Next action

Wait for "approved" (and answers to section 7). Then I start with Step 3d: short plan for that step with exact files, wait for approval again, build in small parts with lint, format check and tests after each part.
