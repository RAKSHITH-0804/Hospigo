# Phase 2.2 and 2.1: testing at the END (decided by Rakshith, 27 Nov 2026)

All three Phase 2.2 checkpoints are built first. The full test round for Phase 2.1 AND Phase 2.2 happens once, at the end. Until then each checkpoint is only checked by unit and endpoint tests, lint, format and builds.

## Status per checkpoint

| Checkpoint                                                 | Built       | Jest API / web | Newman                              | e2e                            | Manual  |
| ---------------------------------------------------------- | ----------- | -------------- | ----------------------------------- | ------------------------------ | ------- |
| 1 Cleanup and privacy (`feature/step-2-2a-cleanup`)        | yes         | 1114 / 1858    | NOT run (newman not installed here) | 20 of 20 on the isolated stack | pending |
| 2 HQ console and branches (`feature/step-2-2b-hq-console`) | see handoff | see handoff    | pending                             | pending                        | pending |
| 3 UI redesign and close                                    | not started |                | pending                             | pending                        | pending |

## The end-of-phase round (in this order, one minute pause between login-heavy runs)

1. `npm run dev:reset` (dev database), then both dev servers; click through `docs/guides/manual-regression-checklist.md` for every role (HQ Admin, HQ Staff, Super Admin, Admin, Receptionist, Nurse, Doctor).
2. `npm run e2e:fresh`, `npm run build -w @hospigo/api`, `npm run e2e:stack` (own terminal), then `E2E_BASE_URL=http://127.0.0.1:3101 npm run e2e` (PowerShell: `$env:E2E_BASE_URL="http://127.0.0.1:3101"; npm run e2e`). Without the variable the tests hit the dev web on 3001.
3. Newman (`npx newman run postman/collections/<file>` with the Hospigo Local environment; needs the package downloaded once): run `hospigo-2-2a-hq-without-entry`, the HQ console collection of checkpoint 2, then the combined `hospigo-phase2-all` (rebuild with `node scripts/build-postman-phase2.mjs`).
4. Record the results in this file (counts, failures, fixes).

## Results log

(empty until the end-of-phase round)
