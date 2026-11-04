# Continuous integration

GitHub Actions runs on every push to `develop` or `feature/**`, on pull requests into `develop` or `main`, and on manual `workflow_dispatch`.

## What CI does

Two jobs share the same triggers:

| Job     | Purpose                                                                                                                                                                                                            | Blocking?                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `ci`    | Install (`npm ci`), lint, Prettier check, build `@hospigo/api`, bootstrap Postgres roles/DBs with `scripts/db/create-roles.mjs`, run `npm test -w @hospigo/api` against service containers (Postgres 16 + Redis 7) | Yes                                    |
| `audit` | Installs with `npm ci --ignore-scripts` (audit only needs the lockfile; skips prisma generate which needs `DATABASE_URL_OWNER`), then `npm audit --audit-level=high`                                               | No — report only (`continue-on-error`) |

Workflow file: `.github/workflows/ci.yml`. Permissions are `contents: read` only. No repository secrets are used; passwords for the ephemeral CI database are generated per run (or a fixed CI-only Postgres superuser password for the service container).

Husky is disabled in CI (`HUSKY=0`) so the root `prepare` script does not try to install git hooks on the runner.

## How to read a failure

1. Open the failed workflow run → failed job → failed step.
2. **Lint / format:check** — fix locally with `npm run lint` and `npm run format`, then push.
3. **Build API** — TypeScript or Prisma generate failed; reproduce with `npm run build -w @hospigo/api`.
4. **Create Postgres roles** — bootstrap against the service container failed; usually an env/.env mismatch (CI writes a runner-local `.env` before this step).
5. **Test API** — Jest failed. The suite rebuilds `hospigo_test` in `globalSetup` (DROP SCHEMA → migrate → reference seed). Check the rebuild/guard message first, then the failing spec name.
6. **audit** — advisory only. A red `audit` job does not block merge while it is report-only; still open a follow-up if high/critical findings appear.

## Feature-branch and PR flow

1. Branch from `develop`: `feature/step-N-name` (example: `feature/step-5-ci`).
2. Push the branch.
3. Open a **small** PR into `develop` using the PR template (`.github/pull_request_template.md`). Title form: `type(scope): short summary`.
4. Merge only when the blocking `ci` job is green.
5. `develop` is merged into `main` only at release points — not for every feature PR.

## Why audit is report-only

Dependency audit noise and transitive advisories should not block delivery while the monorepo is early. The `audit` job still runs so the team can see high-severity findings without failing the PR gate. Tightening this later (fail on high/critical) is intentional follow-up work.

## How the test database is created in CI

1. The `ci` job starts Postgres 16 and Redis 7 as **service containers** (no Docker CLI in the workflow).
2. A step generates per-run role passwords (hex), masks them in the log, writes them to `GITHUB_ENV` and a runner-local `.env`, and points `DATABASE_URL_TEST` / `DATABASE_URL_OWNER_TEST` at database `hospigo_test` on `127.0.0.1`.
3. `node scripts/db/create-roles.mjs` connects as the ephemeral Postgres superuser and creates roles (`hospigo_owner`, `hospigo_app`, `hospigo_hq`, …) plus databases `hospigo` and `hospigo_test`.
4. `npm test -w @hospigo/api` runs; Jest `globalSetup` rebuilds `hospigo_test` (guards require both app and owner test URLs to name `hospigo_test` and be local), applies migrations, and seeds reference data before the suite.

Local machines still use Memurai/Postgres without Docker; CI is the place that uses service containers.
