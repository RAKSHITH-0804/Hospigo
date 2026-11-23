# Decisions, Step 8a (NestJS 12 upgrade and the 5 high npm findings)

Branch: `feature/step-8a-nestjs-12`, from `develop` at `4919548` (the Step 7f merge, PR #57). ONE branch, ONE pull request (Rakshith's decision, 23 Nov 2026; the earlier proposal to split it into 8a-1 and 8a-2 was dropped). The commits are ordered so the security fix can ship on its own if needed.

## Decisions recorded

1. **22 Nov 2026 (Rakshith): the 5 high `npm audit` findings are folded into 8a.** The audit (`docs/audit/phase2-audit.md`, question 13) only suggested it; this is the recorded decision.
2. **8a is one PR with commits in this order:** (1) docs, (2) `@nestjs/*` to the 11.2.11 patch line, (3) the `effect` overrides entry, (4) NestJS 12 and the code fixes, (5) docs and the final report.
3. **Plan changes found while planning (23 Nov):**
   - The multer high does NOT need Nest 12. `@nestjs/platform-express@11.2.11` (a patch of the line we use) depends on multer 2.5.0, which fixes it.
   - The Nest 12 packages are ESM-only (`"type": "module"`). A CommonJS app can still use them on Node 22.12 or newer (require of ES modules). **Jest can load them only on Node 24.9 or newer**, so there is a risk for our Jest suites on Node 22. Allowed workaround: a Jest transform, for at most one hour. **The Node version, the CI Node version and `engines` are NOT changed without Rakshith's approval.** If Jest cannot run on Node 22, 8a stops after commit 3 (the security fix is shipped, green) and the Nest 12 work stays on a separate local branch with the options and their cost.
   - The three Prisma-tooling highs (`effect`, `@prisma/config`, `prisma`) are not cleared by Nest. `prisma@7.10.1` pins `effect@3.20.0` inside `@prisma/config` (build-time CLI only). The stable Prisma line has no newer fix (`latest` is 8.0.0-rc.34, a release candidate). They are handled by an npm `overrides` entry for `effect` (3.22.5, the fixed line), proven with `prisma generate`, `migrate deploy` on `hospigo_test` and the dev seed. If it fails, the entry is removed and the finding is documented as build-time only. **Never** downgrade Prisma (npm's own suggestion, 6.12.0, is wrong), **never** `npm audit fix --force`, **never** `nest upgrade` (it would also move TypeScript and Jest).
4. **Stays as it is in 8a:** TypeScript 5.9.3, Jest 30.5.2, ts-jest 29.4.15, `@types/node` 22. ESLint 10, `eslint-config-prettier` 10 and dotenv 18 stay separate (lint tooling for the whole repo, and dotenv 18 arrives inside `@nestjs/config` 12 anyway).
5. **Multer exposure until 8a is done (confirmed):** the 7e upload uses `FileInterceptor` with size limits only and NO `fileFilter`, so the advisory (a pending asynchronous `fileFilter`) does not apply to our code, and the upload route sits behind our guards. The finding is a flagged dependency, not a reachable attack.

## Corrections to older notes

- Baselines after Step 7f: **API 857, web 1581** (not 1580).
- Postman **7d = 64 requests, 115 checks**; Rakshith's run on 22 Nov: 114 passed, 1 failed. **Why it failed:** Postman builds a request from `url.query`, not from the text of the URL. One request had its `?name=value` only in the text, so Postman sent it without the filter and the check failed. It was fixed in the file and re-run OK (per Rakshith). A scan on 23 Nov of all 11 collections found no request with a query string but an empty `query` list. **Postman 7f = 29 requests, 44 checks** (44 of 44 passed on 23 Nov).
- The decisions file is `docs/decisions/decisions-7f.md` (older notes wrote `docs/decisions-7f.md`).

## Step 8b scope (full list, from Rakshith)

- A **starter script** that creates the standard payment modes, vitals fields and number series, and **NO demo data**.
- **Excel upload** of medicines, tests, prices and doctor fees (the doctor fees need both NEW and FOLLOW_UP rows).
- A **price-change route with an effective date** (Admin and SuperAdmin only).
- A **doctor availability, timings and leave screen**.

## Done when (8a)

lint, `format:check`, API build, web build, all API tests (baseline 857) and web tests (baseline 1581) pass; `@nestjs/core` is still in `apps/api/node_modules`; the compiled API starts and answers `/health`; `npm audit` is rerun and every remaining finding is listed with its reason; Postman 7d, 7e and 7f are run by Rakshith. No migration expected; if one is ever needed it is named after `20261126092000`.
