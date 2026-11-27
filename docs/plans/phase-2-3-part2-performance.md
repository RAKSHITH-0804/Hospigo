# Phase 2.3, Part 2: speed and load (item 17 of Rakshith's list)

Status: NOT STARTED (28 Nov 2026). Start from branch `feature/step-2-3-feedback` (create `feature/step-2-3b-performance` from it). Follow `CLAUDE.md` (plan first, wait for "approved", small commits, never weaken security, tests at the end of the phase).

## Rakshith's words

"Sometimes the loading takes too much time and when I press Ctrl+Shift+R the page loads. Optimise the full code, it should load immediately without taking too much time. And when there are more than 5000 users using the website at the same time nothing should break or take time. I need fully optimised code."

## Honest scope

- Code alone cannot promise "5000 users at once". It depends on the server. The job is: measure, remove every avoidable delay, prove with a load test what ONE server holds, and write down what to add (more API copies, a database connection pooler, Redis, a CDN) to reach 5000. Never claim a number that was not measured.
- Never trade security for speed: tenant isolation (row level security), permission checks, audit logging, rate limits on login stay as they are. No patient data in any shared cache or in the browser.
- "Ctrl+Shift+R fixes it" is almost certainly the development server (`npm run dev -w @hospigo/web` compiles each page on first visit and holds old chunks). Measure with the production build first.

## Steps

1. **Measure on a production build.** `npm run build -w @hospigo/api`, `npm run build -w @hospigo/web`, start both (`docs/guides/dev-commands.md`, section 9). For each role (Super Admin, Admin, Receptionist, Nurse, Doctor, HQ Admin) record the time of: sign in, dashboard, OPD queue, patients list, register patient, new visit, consultation, collection report, print pages. Use the browser performance panel (or a small Playwright script that prints timings) and the API log. Write the table into `docs/guides/performance-report.md`.
2. **Find and fix the real causes.** Likely candidates, check each with evidence:
   - Server pages that fetch one thing after another instead of in parallel (`Promise.all`). The dashboard, queue and consult pages are the first to look at.
   - More than one session or permission lookup per request (CLAUDE.md rule: ONE per request).
   - Missing database indexes on the biggest tables (visits, bills, payments, patients, audit log, ledger). Use `EXPLAIN (ANALYZE, BUFFERS)` on the slow queries; add an index by a new migration only when the plan proves it (migration names go after `20261129099000_hq_superadmin_reset`).
   - The dashboard summary and the HQ monitoring function reading many rows (limit windows, add indexes, or cache for a few seconds PER hospital and branch, never across hospitals).
   - Heavy libraries loaded on every page (the print designer, tiptap rich text editor, calendar): load them only on the pages that need them (`next/dynamic`).
   - Lists without paging, polling too often (queue refresh, pending counts every 20 s: consider one combined endpoint or a longer interval when the tab is hidden).
   - Images: logo and signature served with long cache headers (they never change once stored, the id changes).
   - Next.js: static assets cache headers, `loading.tsx` skeletons so something shows at once, no client component where a server component is enough.
3. **Connection and process settings.** Prisma pool size per process, Postgres `max_connections`, Redis usage, rate limits sized for many users behind one address (an office behind one IP can hit the 20 a minute login limit: check `AUTH_IP_RATE_LIMIT_PER_MIN` handling and document the right production value). Node: run the API with several processes (cluster or a process manager) in production; write the exact command in the report.
4. **Load test.** Add a script (autocannon or k6, installed as a dev dependency or run with `npx`; ask before downloading) that signs in as reception, nurse and doctor and browses: dashboard, queue, patients search, register, visit, vitals, print. Run at 100, 500, 1000 and 2000 simulated users against the production build on the isolated test stack (`npm run e2e:stack` style ports, database `hospigo_test`, never the dev data). Record p50 and p95 response times, error rate, CPU and memory of API, web and Postgres. Stop each run when errors appear.
5. **Report.** `docs/guides/performance-report.md`: the before and after table, what was fixed (one line each, with the commit), the load test numbers, what one server holds, and the deployment recipe to reach 5000 (how many API copies behind a load balancer, PgBouncer, Redis, CDN for static files) with the assumptions stated.
6. **Docs and close.** Update `docs/handoff-phase2.md` (CURRENT STATE), `docs/engineering-tracker.md`, `docs/CHANGELOG.md`, add the manual checks to `docs/guides/manual-regression-checklist.md`. Run: `npm run lint`, `npm run format:check`, `npm test -w @hospigo/api`, `npm test -w @hospigo/web`, both builds.

## Review gate before merging any of it

Run the adversarial self-review of CLAUDE.md on every change that touches caching, sessions, permissions or queries: can one hospital ever see another's data through a cache or a query change? Can a cached answer outlive a permission change? Add tests for the gaps.

## What not to do

Do not change money, ledger or refund logic. Do not remove or weaken tests. Do not add a cache that is shared between hospitals. Do not run the load test against the dev database `hospigo`.
