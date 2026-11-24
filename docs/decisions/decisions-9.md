# Decisions, Step 9 (OPD hardening and exit)

Branch `feature/step-9-hardening-exit` (from `develop` at `23a376a`, the merge of 8c PR #61). One PR. Migrations were applied to `hospigo_test` only; Rakshith migrates the dev database.

## Decisions (Rakshith, 24 Nov 2026)

1. **Branch Admin creating roles: NOT now.** Later phase, on the manager list. _Why:_ roles are hospital-wide today; making them branch-owned needs a migration and a permission design that is not needed for release 1.
2. **Per-branch doctor fees: YES, built in this step.** This **supersedes** the 24 Nov note in `decisions-8c.md` ("fees stay per doctor, never per branch"). The Branch Admin or SuperAdmin sets them (rules below).
3. **A switched-off person keeps a working token for up to 15 minutes: ACCEPTED, no change.** Recorded as a known limit. Every route that asks for a permission refuses them at once; only routes that need no permission (for example reading their own profile) keep working until the token expires.
4. **The repeat-visit-free rule is unchanged.**
5. **Both** automated browser smoke tests **and** the manual regression checklist. (Status of the browser tests: see "C" below.)
6. **Out of scope** (manager list): part payment, dues list, Emergency flag, online booking and doctor slots, cancelling visits that are not WAITING, Branch Admin creating roles.

## A. Hardening

### A1. The application login loses DELETE (migration `20261128090000_revoke_users_delete`)

- The first migration gave `hospigo_app` DELETE on `users` and on the hospital structure tables. **Checked, not assumed:** no `delete`, `deleteMany` or raw `DELETE` on these tables exists in the application code or the seeds (staff, roles, role permissions, assignments and branch links are switched off with `is_active`, never deleted; the only deletes in the app are on `doctor_leave`, `doctor_timings`, `print_templates`, `prescription_items`, `investigation_orders`, and `auth_sessions`, which keep their grant).
- `REVOKE DELETE` on `users, hospitals, hospital_settings, hospital_module_subscriptions, branches, branch_modules, roles, role_permissions, role_assignments, role_assignment_branches, user_branches`. The owner login (migrations, tests) is unchanged.
- _Why also the other tables:_ a hospital delete by the app login would cascade to everything that the append-only triggers do not protect. Nothing needs it.
- Tests: `users-delete-grant.spec.ts` (the app login cannot DELETE a user, has no DELETE on the listed tables, deactivating and reactivating a person still works).

### A2. Re-check (report; nothing needed fixing)

| Check                                 | Result                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forced RLS on every tenant table      | Queried the rebuilt test database: 68 tables, **57 have a `tenant_id` and all 57 have RLS enabled and forced**. The 11 tables without `tenant_id` are global or belong to another login: `hospitals` (RLS forced, keyed by `id`), `modules`, `permissions`, `import_types`, `patient_field_catalog` (reference data), HQ tables and patient-portal tables (own logins). |
| Every route has an access marker      | `permission.route-scan.spec.ts` stays green (it fails the build if a route has neither a permission, a token kind, nor `@Public`).                                                                                                                                                                                                           |
| Public routes                         | 13: `auth/hospital/login`, `auth/hq/login`, `auth/refresh`, `auth/logout`, `auth/forgot-password`, `auth/hq/forgot-password`, `auth/reset-password`, `auth/activate`, patient `auth/request-otp`, `auth/verify-otp`, `auth/refresh`, `auth/logout`, and `health`.                                                                             |
| Rate limits                           | **Already present** on login, HQ login, refresh, change-password, switch-branch, forgot-password (both), reset-password, activate and the patient OTP routes (`wrapRateLimit`, Redis, per IP and per account). `logout` has none: it needs a valid refresh token and only ends that session. Nothing added.                                  |
| Personal data in logs                 | Logs carry ids, masked phone numbers and a mail subject. One full phone number and OTP text is logged by `DevMessageProvider`, which **refuses to start when `NODE_ENV=production`**. Audit entries hold ids and field names (re-checked for the new fee audit: ids and amounts only). Nothing changed.                                     |

### A3. Upgrade path

- `scripts/rebuild-hospigo-test.ts` rebuilt `hospigo_test` from zero (all migrations plus the reference seed) several times in this step; it applies cleanly (69 tables after the fee column, 83 policies).
- New test `system-roles-upgrade.spec.ts`: a system role that lacks a permission gets it back from `ensureSystemRolesForTenant`, and a custom role (with one permission on and one switched off) is left exactly as it was. The seed only touches roles by their system code.

### A4. `npm audit` and Dependabot

- **0 high, 28 moderate** (was 36 with 5 high before 8a). Three roots: `glob` (through the Jest toolchain, dev only), `minimatch` (through `shadcn`, a dev tool), `uuid` (through `exceljs`; the advisory needs a caller to pass a buffer to `v3/v5/v6`, which `exceljs` does not). Each fix offered by npm is a major downgrade or a breaking change (`jest@29`, `shadcn@1`, `exceljs@3`), so none was taken. **No `npm audit fix --force`.**
- Open Dependabot branches: `npm-minor-patch` (8 updates), `typescript-eslint` (2 updates), `github-actions` (2 updates). **Recommendation:** merge the three after `ci` is green on each (they are minor and patch updates); do them one at a time after this PR is merged, not inside it.

### A5. Speed (EXPLAIN on realistic volume)

Measured on scratch copies of the tables (`LIKE ... INCLUDING ALL`, synthetic rows, dropped afterwards): 200,000 patients and 700,000 bills.

| Query                                           | Plan / time                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Patient by UHID, by phone                       | index, 0.03 to 0.09 ms                                                                                                                                                                                                                           |
| Patient name prefix, and the reception search box (name, UHID, phone arms) | index, 0.7 to 4 ms                                                                                                                                                                                         |
| Patient list page (by created date)             | index only, 0.03 ms                                                                                                                                                                                                                              |
| Name _contains_ (leading wildcard)              | sequential scan, **330 ms at 200k patients.** The search box also has a word-start arm (`% word%`) that cannot use an index; the OR with the prefix arm still ended on the date index in the measured case. Left as is: needs `pg_trgm` (a database extension installed by a DBA). Follow-up. |
| Bills of one visit (tests billing, consultation) | **sequential scan, 160 ms; with the new index 0.06 ms.** Fixed: migration `20261128100000_bills_visit_index` (`bills (tenant_id, visit_id)`).                                                                                                     |
| Bills of a branch for a day                     | index, 0.4 to 15 ms                                                                                                                                                                                                                              |
| Unpaid bills                                    | partial index exists (measured only on an unrealistic all-unpaid dataset; not used for a decision)                                                                                                                                               |
| Visits (queue, per patient, per doctor)         | **not measured with data**: the synthetic fill was refused by the visit table's own check constraints. The existing indexes match the query shapes by design (`branch, doctor, status, queued_at`; `patient, created_at`; `branch, visit_date`).    |
| Prices, imports                                 | small tables (hundreds of rows); not measured.                                                                                                                                                                                                   |

### A6. Stored files of cancelled or failed Excel uploads

- When a batch ends as FAILED (a failed preview) or CANCELLED, its uploaded file is deleted from storage (best effort; a storage error never changes the batch). **A posted batch keeps its file; a batch that is not FAILED keeps its file.** Tests: after a cancel (also after approval) the file is gone; after posting it stays.

## B. Per-branch doctor fees (money path, review gate)

**Design (as specified, no unsafe part found):**

- Migration `20261128110000_doctor_fee_branch`: nullable `doctor_fees.branch_id` with a composite foreign key to `branches (tenant_id, id)` (a branch of another hospital cannot be attached; `NULL` skips the check). A row with no branch is the doctor's hospital-wide fee: **every existing row is unchanged and stays valid.** The unique key became `(tenant, doctor, visit type, COALESCE(branch, ''), effective_from)`: a plain unique key treats `NULL` as distinct, so two hospital-wide versions at the same moment would have been allowed. The old triggers already refuse UPDATE, DELETE and TRUNCATE on the table, so a fee row, its amount and its branch can never change; grants (SELECT, INSERT) and forced RLS are unchanged.
- **Lookup** (`pickDoctorFee`, one function for billing, the doctor list and the tests) for a visit in branch X: the newest started row for (doctor, type) in branch X, else the newest started hospital-wide row, else (follow-up only) the new-visit fee found the same way, else `FEE_NOT_CONFIGURED`. A branch fee beats the hospital-wide fee whatever their dates (a later hospital-wide change does not touch a branch that has its own fee). A row that starts in the future is ignored until its day. A bill line keeps the id of the row it used, so bills already made never change.
- **Who sets what:** hospital-wide fee: a hospital-wide Admin only (permission in every branch). A branch fee: a hospital-wide Admin for any branch, a Branch Admin for **their own branches only**. Everyone else: 403 `PRICE_SCOPE_FORBIDDEN`. **A rule change on purpose:** before, a Branch Admin could set the hospital-wide doctor fee (the permission `opd.prices.write` is on their role); now they cannot. A doctor must work in the branch to get a fee for it (400 `DOCTOR_NOT_IN_BRANCH`); a branch of another hospital or an unknown id is 400 `BRANCH_NOT_FOUND`.
- **Reading:** the list with `branchId` shows the fee in effect for that branch with its scope (`BRANCH` or `HOSPITAL`) and `canSetHospitalWide`; without `branchId` it shows the hospital-wide fees only. A Branch Admin may read only their own branches (403 otherwise). History takes the same optional `branchId`.
- **Excel DOCTOR_FEES:** optional `Branch code` column (blank = hospital-wide). A Branch Admin's blank or foreign-branch rows are exceptions (`BRANCH_SCOPE_FORBIDDEN`); an unknown code `BRANCH_NOT_FOUND`; a doctor who does not work there `DOCTOR_NOT_IN_BRANCH`; the file key includes the branch, so the same doctor and type in two scopes is not a duplicate. The posting step uses the same permission check again.
- **Web:** the Prices screen sends the active branch (from the session, on the first load and every reload), shows `This branch` or `Hospital-wide` beside each doctor fee, the button `Set fee for this branch` on a hospital-wide fee, and (hospital-wide Admins only) an `Applies to` choice. Nothing is removed: every change is a new version.
- **Effect on other branches, as asked:** the registration fee and the test prices keep the 8b rule (hospital-wide, permission `opd.prices.write`). A Branch Admin can therefore still change the registration fee and test prices **for every branch**. Not changed in this step; decide whether those should be limited to hospital-wide Admins (listed in the exit report).

**Self-review (adversarial pass, tests in `doctor-fee-branch.endpoints.spec.ts`, `doctor-fee.spec.ts`, `imports.endpoints.spec.ts`):**

| Tried                                                                                                  | Covered                                                  | Result                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Branch fee beats hospital-wide in its branch, other branch and hospital-wide row untouched, by real visits and bills in both branches | yes                                                      | holds                                                                                                       |
| Follow-up with its own hospital-wide fee vs a branch new-visit fee; follow-up with no fee at all        | yes                                                      | follow-up uses its own fee (branch, then hospital-wide), else the new-visit fee found the same way          |
| Branch fee that starts later; hospital-wide fee newer than the branch fee; bills made before           | yes                                                      | ignored until its day; branch still wins; old bills unchanged                                               |
| Branch Admin: own branch, another branch, hospital-wide fee, the other Branch Admin, a receptionist    | yes                                                      | own branch 200; all others 403 and nothing written                                                          |
| Branch of another hospital, unknown branch, another hospital's doctor, doctor not in the branch        | yes                                                      | 400 / 404, nothing written                                                                                  |
| Branch Admin reading another branch's list or history                                                  | yes                                                      | 403                                                                                                         |
| Same request twice; two different changes at the same moment                                           | yes                                                      | second is "unchanged"; exactly one of two racing changes wins (the other gets `VERSION_EXISTS`)             |
| Database: update, delete, move a fee to another branch, cross-hospital branch, duplicate scope and moment | yes                                                      | all refused; hospital-wide and branch rows may share a moment                                                |
| Excel: unknown branch, wrong branch for a Branch Admin, blank row for a Branch Admin, doctor not in branch, duplicates | yes                                                      | each row an exception with its reason; nothing else lost                                                    |
| Audit entry                                                                                            | yes                                                      | ids and amounts only, plus the branch id                                                                    |
| **Found and fixed:** the unique key would have allowed two hospital-wide versions at one moment (NULL is distinct) | test (database)                                          | expression unique index                                                                                     |
| **Found and fixed:** the price list query would have mixed branch rows into the hospital-wide view      | test (list without branch)                               | scope-aware lookup, branch first                                                                            |
| **Found, deliberate:** a Branch Admin could set the hospital-wide doctor fee                            | test                                                     | now 403 (rule change, see above)                                                                            |
| Not covered                                                                                            | a doctor who later leaves a branch keeps an inert branch row (the list shows doctors by current branch; billing refuses a doctor not in the branch) | acceptable                                                                                                  |

**Verdict:** safe to approve. Decision for Rakshith: limit registration-fee and test-price changes to hospital-wide Admins? (see exit report, open decisions).

## C. Browser smoke tests and screen check

See the section "Status of C" at the end of this file (written when C was done or stopped).

## D. Postman

- All 14 collections (3d to 8c) are committed under `postman/collections/`. **Scanned first:** no JWT-like text, no `Bearer` literal, no key, no connection string, no password literal; every login uses a `{{variable}}`; the only literals are the local base URL and demo `example.test` emails. The environment files (with the demo passwords) are never committed (`*.postman_environment.json` is ignored). `.gitignore` now ignores everything in `postman/` except the collections and their README; `.prettierignore` skips the exported JSON; the `CLAUDE.md` rule was updated. Postman was NOT run by the assistant.

## Known limits (accepted)

- **15-minute token window after a switch-off** (decision 3).
- **Web dates use one time zone for the whole web app** (`WEB_REPORT_TIME_ZONE`), not the hospital's. Fine for India only; revisit when a hospital in another zone is onboarded.
- **A leave request follows the doctor's branch** (a request can move to another Admin's list; a hospital-wide Admin always sees it).
- Patient search by a name _fragment_ (leading wildcard) scans the patient table: 330 ms at 200,000 patients. Needs `pg_trgm` when a hospital reaches that size.

## Follow-ups noticed and not done

- Registration-fee and test-price changes by a Branch Admin affect every branch (decision needed).
- `pg_trgm` index for name search (database extension).
- Visits tables were not measured with data (check constraints block a naive synthetic fill); measure on the staging database.
- Dependabot: merge the three open update branches one at a time after `ci` is green.
