# Hospigo: working rules for Claude Code

Hospigo is Indigo's multi-tenant hospital management SaaS. Monorepo with two workspaces:
`apps/api` (backend: NestJS, Prisma, PostgreSQL with row level security) and `apps/web` (frontend: Next.js).
We are in Phase 2 (OPD). Current progress and the step list: `docs/engineering-tracker.md`.

## Who you are working with

Rakshith is a junior developer and Hospigo is his first big project. You are his lead and guide.
Explain new things in plain words: what it is, why it exists, how it works here, how to check it.
Short plain summary first, then steps. Keep token use low.

## How we work

- Plan first. Show a short plan and WAIT for "approved" before editing anything.
- No guessing. If you have not opened a file or seen a result, say so ("not found" or "not checked").
- Small steps. After each part run lint, format check and the tests of the workspace you touched, and fix before moving on.
- Show a short report: what changed (files, one line each), test counts before and after, anything you decided that was not in the files, anything not done.
- NEVER commit or push unless Rakshith says so. Review happens on the diff first, then a hands-on test.
- Never paste or ask for passwords or tokens. Passwords live in `.env`. Demo logins are in `docs/dev-accounts.md`.

## Git and pipeline

- One feature branch per step from `develop`. PRs go into `develop` (the base has slipped to `main` before: check it). Merge with a merge commit. Only release PRs go develop to main.
- Required check is `ci`. The `audit` job is red by design and not required.
- Use `git --no-pager`. Stop dev servers before `npm ci`. Never run `npm audit fix --force`.
- Before any commit: `git checkout -- apps/web/next-env.d.ts`, `npm run format:check`, and make sure `.env` is not staged.
- Postman folders (`.postman`, `postman`) are git-ignored.

## Standing rules (non-negotiable)

- Zero hardcoding: settings, env, theme tokens, one typed copy file for UI text (`apps/web/src/config/staff-copy.ts`). Fixed sizes only in `globals.css`. Scan tests enforce this.
- Every table has row level security. Tenant isolation must never be weakened.
- Money is integer paise, never edited or deleted (reversal entries only).
- Audit stores field names, not personal values.
- The access token never reaches the browser: not in URLs, bodies, logs, `NEXT_PUBLIC` vars. No patient data in browser storage.
- Web forms are client components calling Next route handlers (no server actions). Route handlers return JSON 401/403 and never redirect.
- No fake numbers, mock tiles or placeholder data on real screens.
- Sukshema Hospital is only a reference example. Never bend the product to it.
- Do not delete or weaken existing tests. Update them only when behaviour deliberately changes.

## Dev environment

- Servers from the repo root: `npm run dev -w @hospigo/api` (port 3000), `npm run dev -w @hospigo/web` (port 3001).
- Open the web app at `http://127.0.0.1:3001` (never `localhost`).
- Database: `npm run prisma:migrate -w @hospigo/api`, `npm run prisma:seed -w @hospigo/api` (dev seed needs `NODE_ENV=development`).
- Tests: `npm test -w @hospigo/api`, `npm test -w @hospigo/web`. Lint: `npm run lint`. Format: `npm run format:check`.
- Demo access codes: `demo-north-main`, `demo-north-east`, `demo-south-main`, `demo-south-west`.
- Access tokens last 15 minutes.
- When looking at the app in a browser, use the demo accounts only. Never enter real data.

## Docs to read before working

`docs/api-opd.md`, `docs/api-auth.md`, `docs/ui-design.md`, `docs/schema-opd.md`, `docs/system-design.md`, `docs/dev-accounts.md`, `docs/engineering-tracker.md`, `docs/env-reference.md`.
