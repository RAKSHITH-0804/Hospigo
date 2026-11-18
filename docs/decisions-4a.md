# Hospigo Phase 2, Step 4a: visits, billing and cash payment (decisions)

Written 18 Nov 2026 on branch `feature/phase2-step-4a-visit-billing`. Read with `docs/plan-opd-first-flow.md` and the "As built (Step 4a)" section of `docs/schema-opd.md`.

## Decisions (Rakshith, 18 Nov)

- **4a-1 and 4a-2 are merged into one step 4a**: one branch, one PR, two commits. The migration commit is a mandatory review gate; the API part starts only after approval.
- **Ledger is written only by database triggers**; the app role has no INSERT on `ledger_entries`.
- **Clinical tables** (consultations, notes, addenda, vitals, prescription) are built in the 5a migration, not in 4a.
- **Admin roles**: SuperAdmin and Branch Admin currently receive every active permission automatically. In the API part of 4a they are changed to get only the read permissions for visits and billing, never notes, vitals or cash collection (Q6: notes only for Doctor and Nurse).
- **Doctor gets `opd.vitals.read` and `opd.vitals.write`** (applied in the 5a seed).
- Earlier decisions that apply: bill and payment are separate records, the reception button does visit + bill + payment in one transaction with an idempotency key; free follow-up is a hospital setting and makes a zero bill that counts as settled; the registration fee is once per patient as a bill line; part payments, refunds, investigations, Emergency and print templates are cut for this flow.

## Final permission list (codes are added in the API part of 4a and in 5a)

| Code                                   | Receptionist | Nurse          | Doctor         |
| -------------------------------------- | ------------ | -------------- | -------------- |
| `opd.visits.create`                    | yes          |                |                |
| `opd.billing.collect`                  | yes          |                |                |
| `opd.visits.read`                      | yes          | yes            | yes (own)      |
| `opd.billing.read`                     | yes          |                |                |
| `opd.queue.read`                       |              |                | yes            |
| `opd.vitals.read` / `opd.vitals.write` |              | read and write | read and write |
| `opd.notes.read`                       |              | yes            | yes            |
| `opd.notes.write`                      |              |                | yes            |

## What the migration enforces

See "As built (Step 4a)" in `docs/schema-opd.md`. In short: append-only bill lines, payments and ledger; bills immutable except ledger-maintained paid columns; no overpay (row lock plus check); bill equals lines at commit; registration fee once per patient; queue gate; visit state guard; counters only forward; RLS forced on all six tables; no grants for HQ and patient roles.

## Tests

`apps/api/src/database/visits-billing.spec.ts` (39 tests on `hospigo_test`: privileges, RLS, append-only, money rules, parallel payments, queue gate, registration fee, counters, Prisma models). `rls.tenant-hq.security.spec.ts` got tenant-B sample rows for the six new tables (deliberate: the spec requires a sample for every tenant table). API tests 314 -> 353. Every protection in the migration was removed one at a time ("mutation check") and at least one test failed each time, except `opd_assert_tenant` inside the two AFTER-insert triggers, which is defence in depth (RLS WITH CHECK already refuses a foreign tenant before those triggers run).

## Self-review findings (fixed in this part)

- The tenant guard used by SECURITY DEFINER triggers skipped its check when the session tenant was empty, which could let an application connection with an emptied tenant read error text about another hospital's bill. Now the application login must carry a tenant that equals the row's tenant. Test added.

## Known limits and follow-ups

- RLS isolates hospitals, not branches: branch isolation is a service rule (tested in the API part).
- The owner role (BYPASSRLS, runs migrations) can still disable triggers; keep owner credentials off the app server (go-live item).
- `visit_date` and `token_date` are supplied by the service; the database cannot know the hospital's local day. The API part allocates them from the hospital timezone and tests midnight.
- A queue gate for part-paid and Emergency visits is intentionally not in the database yet; adding them later needs a migration that changes `opd_visits_guard`.
- `patient_registration_fees.voided_at` has no app grant yet (added with refunds in 6a).
- Prisma does not model triggers or partial indexes; the SQL migration is the source of truth. `prisma migrate diff` could not be used (Prisma 7 removed `--from-url`); the DB tests exercise every model instead.

## API part (second commit of 4a)

Decided while building (Rakshith to confirm at review):

- **One endpoint takes the money**: `POST /opd/visits` creates visit, bill, lines, registration-fee record, payment, ledger (trigger), token and audit in one transaction. There is no separate "pay a bill" endpoint yet (nothing is ever left unpaid in this flow; part payment arrives with its own step).
- `POST /opd/visits` needs `opd.visits.create` on the route and `opd.billing.collect` checked inside (without it: 403, nothing created).
- **Reads are branch-scoped by the token**: a visit or bill of another branch is 404 (RLS only separates hospitals; this is the branch rule agreed at the 4a migration review). Doctors who cannot read bills see only their own visits. Nurse and doctor never receive money fields.
- **System admin roles** (SuperAdmin, Branch Admin) now get only `opd.visits.read` and `opd.billing.read` of the new codes; the seed also switches off any earlier grant of the excluded codes (`ADMIN_EXCLUDED_PERMISSION_CODES`, includes the future clinical codes).
- **Follow-up**: needs a completed visit of the same patient with the **same doctor**, any branch (the earlier visit is used only for the date and doctor); inside `follow_up_free_days` (hospital time zone, whole days) the consultation is 0 and settled; outside it the doctor's follow-up fee applies. The doctor's follow-up fee row must exist even when the visit is free (it is the price source of the line).
- **No duplicate-visit warning**: two visits of one patient with one doctor on one day are allowed if the keys differ (a deliberate second visit). A warning belongs in the web step.
- **Tax switched on** returns 501 instead of billing without tax. **Missing bill/receipt series settings** return 409 (and the whole request is rolled back).
- Bill line `code` is the doctor code and `description` the doctor's display name (data, not UI text); the web prints the line kind from its copy file.
- `DoctorAvailabilityService.getAvailabilityInTx` was added (same rules, caller's transaction); `getAvailability` delegates to it.
- `apps/api/src/modules/opd-visits/` (config, errors, DTO, service, controller, module); `GET /opd/doctors` lists members of the active branch only.

Tests: `opd-visits.endpoints.spec.ts` (30 tests: access, input, doctors, create and pay, follow-up window, idempotency incl. parallel, numbering and rollback, midnight token reset, reads, branch and hospital isolation, admin roles). API tests 353 -> 383. Every protection in the service was removed one at a time and a test failed each time.

API-part follow-ups: the bill-number series row is locked for the whole request (hospital-wide serialisation of bill creation; fine at one bill per second, revisit for very large hospitals); a hospital that never configured fees gets `FEE_NOT_CONFIGURED` per request; the web must generate one idempotency key per click and keep it for retries.

## Rakshith's answers at the API review (18 Nov 2026)

- **Postman 4a collection: 55 of 55 checks passed** on the dev database after migrate and seed.
- **Part and split payments are needed soon.** Example: bill 500 paid as UPI 300 + cash 200. The database already allows several payments per bill with their own mode (tested), so this is mostly an API change: `POST /opd/visits` would accept a list of payments that must add up to the total (split tender, bill settled at once), and a separate "pay the rest later" call for true part payment (permissioned exception). Open question for the manager: one receipt per payment, or one receipt covering both. Rakshith will discuss other payment types with the manager and report what else is needed. Placement of this step in the Phase 2 order is still to be decided.
- **Free follow-up counts a completed visit at any branch** of the hospital (date and doctor only). Rakshith asked for a clearer explanation; to be confirmed.
- **Same doctor twice on one day:** Rakshith's view is that the consultation should be charged only once per patient, doctor and day. Not built: today every visit is billed. Needs a decision with the hospitals (do staff enter every re-visit in the system?). Options when decided: a second same-day visit with the same doctor is created at zero (pricing note), or the screen offers the existing visit instead; the web step (4b) will at least show a warning when the patient already has a visit with that doctor today.

### Answers, second round (18 Nov 2026)

- **Split payment gets ONE receipt covering all its payments** (for example UPI 300 + cash 200 on a 500 bill = one receipt number). Consequence for the later step: `payments.receipt_number` is unique per payment today, so split payments need a receipt concept (a receipts row that several payments point to, or equivalent). The 4a migration will already be pushed by then, so it will be a new migration. Not built in 4a.
- **Free follow-up counts a completed visit at any branch: confirmed.** The number of free days is a hospital setting (`opd_settings.follow_up_free_days`, default 7, range 0 to 365), never hardcoded. The permission to change it exists (`opd.settings.write`); the screen and the API route to change it are Step 7b (Settings screens). Who may hold it (SuperAdmin only, or Branch Admin too) is decided in 7b.
- **Same doctor twice on one day: kept as pending work** until Rakshith has talked to the hospitals.
