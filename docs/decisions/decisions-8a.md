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

## Outcome (built 23 Nov 2026, branch `feature/step-8a-nestjs-12`, not pushed)

Commits in order: (1) docs, (2) `@nestjs/*` 11.2.11 (swagger 11.4.8), (3) `overrides: { effect: 3.22.5 }`, (4) NestJS 12, (5) these docs. Commits 2 and 3 were each complete and green by themselves (lint, format, API 857, web 1581, builds, `/health`), so the security fix could have shipped alone.

| Package                                                                                     | Before                             | After             |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------- |
| `@nestjs/common`, `core`, `platform-express`, `platform-socket.io`, `websockets`, `testing` | 11.2.8 to 11.2.9                   | 12.6.0            |
| `@nestjs/config`                                                                            | 4.0.4                              | 12.1.1            |
| `@nestjs/swagger`                                                                           | 11.4.7                             | 12.1.2            |
| `@nestjs/cli`                                                                               | 11.0.24                            | 12.0.15           |
| multer (inside platform-express)                                                            | 2.4.0                              | 2.5.0             |
| express (inside platform-express)                                                           | 5.2.1                              | 5.3.0             |
| `effect` (inside `@prisma/config`, build-time)                                              | 3.20.0                             | 3.22.5 (override) |
| TypeScript, Jest, ts-jest, Prisma, `@types/node`                                            | 5.9.3, 30.5.2, 29.4.15, 7.10.1, 22 | unchanged         |

**npm audit:** 36 findings (5 high, 31 moderate) before; 28 (0 high, 28 moderate) after. Highs gone: `@nestjs/platform-express` and `multer` (multer 2.5.0, commit 2); `effect`, `@prisma/config` and `prisma` (override, commit 3; Prisma NOT downgraded, no `--force`, no `nest upgrade`). Moderates that remain, and why: the Jest family (`jest*`, `@jest/*`, `babel-jest`, `babel-plugin-istanbul`, `test-exclude`), `glob` and `minimatch` (test and lint tooling, need a Jest or typescript-eslint major or a patch not yet released); `@typescript-eslint/*` (a newer 8.73 exists; it belongs to the separate ESLint step); `exceljs` via `uuid` < 11.1.1 (a flaw only when a buffer is passed to uuid v3/v5/v6, which our report export does not do; exceljs has no newer release); `shadcn` and `ts-morph` (a developer tool, not part of the running app).

### The Jest and Node 22 question: solved without changing Node

The Nest 12 packages are ES modules only. The compiled API runs on Node 22.14 as it is (Node loads them with require of ES modules): the compiled API and the dev server (`nest start --watch`) start and answer `/health` and `/health/details`. Jest could not load them, so `apps/api/jest.config.js` now compiles the ES-module-only packages (`@nestjs/*` and a few helpers named in `transformIgnorePatterns`) to CommonJS on the fly, only for files inside `node_modules`, through `apps/api/jest.esm-transform.cjs` (a small wrapper around ts-jest that rewrites `import.meta.url`). Two things I learned: the transform must NOT touch our own `src/generated/prisma/runtime/client.js` (it broke Prisma's error classes: 11 tests failed until the pattern was limited to `node_modules`), and `createRequire(import.meta.url)` inside Swagger had to be removed in the CommonJS copy. **No change to the Node version, the CI Node version or `engines`.** Time used on the workaround: well under the one-hour limit. When the repo moves to Node 24.9 or newer, the transform can be deleted.

### Code fixes

None were needed in our source: the project type-checks with the Nest 12 types (TypeScript 5.9.3), and all 857 API tests pass unchanged. Checked one by one against the Nest 12 migration guide:

- `HospigoValidationPipe` (extends `ValidationPipe`, overrides `transform`): compiles and its tests pass; `errorFormat` keeps the old list format.
- `@Optional()` inheritance: we use no `@Optional()` at all.
- Lifecycle hooks: only independent `onModuleInit` and `onModuleDestroy` (password service, mail processor, dev message provider, Prisma and Redis services); none depends on another service's hook having run first.
- Shutdown draining: `main.ts` does not call `enableShutdownHooks`, so nothing changes on a stop.
- Logger format: no call passes an object after the message.
- HTTP error mapping: every test that asserts our `{ statusCode, code, ... }` bodies passes.
- Global `AuthGuard`, our guards and interceptors, AsyncLocalStorage request context, socket.io health check, the 7e upload (multer 2.5.0, `images.endpoints.spec`), Swagger setup, and the `nest-cli.json` assets copy of the Prisma client (`dist/generated` is present and the compiled API starts): all covered by the passing suites and the start checks.
- `@nestjs/config` 12: we use no Joi.

### Layout and warnings

- After `npm ci`, `@nestjs/core`, `platform-express`, `websockets`, `platform-socket.io`, `swagger` and `testing` are in `apps/api/node_modules/@nestjs` (the rule is kept); `common`, `config` and `cli` are in the root `node_modules/@nestjs`.
- `npm ci` prints `EBADENGINE` warnings: the new Nest CLI pulls `@angular-devkit` 22, which asks for Node 22.22.3 or newer (we run 22.14.0, and `engines` says `>=22.14.0 <23`, which already allows 22.22.3). They are warnings only: `nest build` and `nest start --watch` work on 22.14. Updating Node to the latest 22.x on your machine (no repo change) silences them. Not done, your decision.
- One start failure I could not explain: right after the first `npm ci`, one run of the compiled API stopped at start with `TypeError: Class extends value undefined` while loading the generated Prisma client from `dist`. It did not come back in 8 later starts (clean builds, a repeat of `npm ci` plus build plus start, dev watch mode). If it ever shows again after a pull, delete `apps/api/dist` and build again, and tell me.

### Remaining risks

- The Jest transform is a workaround; a future Nest or Jest release could break it (the fix is Node 24.9+ or removing the packages from the transform list).
- The 28 moderate findings above remain; `typescript-eslint` 8.73 would clear six of them (ESLint step).
- Runtime paths that tests do not cover: a real browser upload of a big image, sockets under load. Postman 7d, 7e and 7f must be run by Rakshith.
