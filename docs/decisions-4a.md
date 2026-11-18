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
