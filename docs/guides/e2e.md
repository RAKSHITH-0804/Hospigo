# Browser smoke tests (Playwright)

Added in Step 9. They open a real Chrome, sign in with the seeded **demo** users and click through the main OPD flow. They are **not** part of CI (they need running servers and a seeded database); run them locally.

## What they cover

| File                  | What                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/login.spec.ts`   | Reception, nurse, doctor and SuperAdmin sign in                                                                                                                                                                                                                                                    |
| `e2e/smoke.spec.ts`   | Register a patient; visit with cash payment (receipt with token); nurse records vitals; doctor writes a consultation and completes it; prescription print page opens; reception asks to cancel a visit and an Admin approves (the visit then shows cancelled); SuperAdmin switches branch and back |
| `e2e/screens.spec.ts` | Screenshots of the consultation page, the New visit page and the OPD queue at 1920, 1366x768 and 390 wide, plus an automatic "no sideways scrolling" check. Pictures go to `e2e/.output/screens/` (never committed)                                                                                |

Not covered (manual checklist instead): printing designs, settings screens, Excel upload, refunds of tests, reports.

## How to run

You need: Google Chrome installed (the tests use it, no browser download), `SEED_STAFF_PASSWORD`, `SEED_SUPERADMIN_PASSWORD` and `SEED_BRANCH_ADMIN_PASSWORD` in `.env` (the demo passwords), and the demo data seeded (`NODE_ENV=development`, `npm run prisma:seed -w @hospigo/api`).

**Against your dev servers** (web `http://127.0.0.1:3001`, API 3000, after you migrated the dev database):

```powershell
npm run e2e
```

**Against an isolated stack** that never touches your dev servers or dev database (API 3100 and web 3101 on `hospigo_test`, built into its own folder `apps/web/.next-e2e`):

```powershell
$env:NODE_ENV="development"; $env:DATABASE_URL_OWNER=$env:DATABASE_URL_OWNER_TEST; npm run prisma:seed -w @hospigo/api   # once; fake demo hospitals only
npm run build -w @hospigo/api
npm run e2e:stack          # leave it running in its own terminal
$env:E2E_BASE_URL="http://127.0.0.1:3101"; npm run e2e
```

(The seed needs `DATABASE_URL_OWNER` and `DATABASE_URL` to point at `hospigo_test`; the demo hospitals are marked as test hospitals, so `scripts/rebuild-hospigo-test.ts` can still rebuild that database.)

## Rules and traps

- The login route is rate limited (20 a minute per address). Each spec file signs each role in **once** and reuses that page. Running the whole suite many times within a minute can still hit the limit; wait a minute.
- Every test makes its own patient (unique name and phone), so the suite can be repeated.
- The tests use demo users only. Never point them at a real hospital.
- `e2e/.output/` (failure pictures, traces, screenshots) is git-ignored. **A failure report can contain the demo password that was typed into the login form**; do not paste those files anywhere.
- If a flow becomes flaky, fix the locator or drop that flow and say so in the step's decisions file; do not add retries that hide a real bug.
- When a screen's words change on purpose, update the words in the spec (they are typed there on purpose).
