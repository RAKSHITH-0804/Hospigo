# Hospigo

Hospigo is a multi-tenant hospital management SaaS built by Indigo.
Each hospital is a tenant; Indigo HQ provisions hospitals and modules.
This repository is the npm workspaces monorepo for the API, web app, and shared packages.

## Tech stack

- npm workspaces monorepo, TypeScript (strict), ESLint, Prettier, Husky
- NestJS API (`@hospigo/api`) with Swagger, Socket.IO, BullMQ, ioredis, `pg`
- Prisma ORM 7 (`@prisma/client` + `@prisma/adapter-pg`) with PostgreSQL
- Local-folder `StorageService` (S3-compatible driver planned later)
- Jest + Supertest for API tests
- `apps/web` and `packages/shared` are placeholders until implemented

## Repository layout

| Path              | Role                                             |
| ----------------- | ------------------------------------------------ |
| `apps/api`        | NestJS API (`@hospigo/api`)                      |
| `apps/web`        | Web workspace placeholder                        |
| `packages/shared` | Shared package placeholder                       |
| `docs/`           | Architecture, folder guide, changelog            |
| `scripts/`        | Labelled operational scripts (e.g. DB bootstrap) |
| `.cursor/`        | Cursor project rules                             |
| `.husky/`         | Git hooks (pre-commit runs `npm run lint`)       |

## Prerequisites

- Git
- Node.js 22 LTS
- PostgreSQL 16 with pgAdmin
- Memurai (Redis-compatible) on Windows
- Cursor
- Mailpit: later, when email is first needed
- Windows only; npm only
- Git Bash inside Cursor for project commands; PowerShell outside Cursor is fine for OS checks
- No Docker

## Getting started

1. Ask the repo owner to add you as a collaborator (the repo is private).
2. Clone with Git (do not use a zip download):

```bash
git clone <repo-url>
cd "Hospigo Code"
git checkout develop
```

3. Install dependencies (also activates Husky hooks via `prepare`):

```bash
npm install
```

4. Create your local env file and fill every key:

```bash
cp .env.example .env
```

Generate each database-related password with a fresh value (never reuse the Postgres superuser password):

```bash
openssl rand -hex 24
```

### `.env` keys (names only — never commit real values)

| Key                          | Purpose                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `APP_URL`                    | Public web app URL                                                                 |
| `API_URL`                    | Public API URL                                                                     |
| `STAGING_URL`                | Staging URL                                                                        |
| `NODE_ENV`                   | `development`, `production`, or `test`                                             |
| `API_PORT`                   | HTTP port for the API process                                                      |
| `PGHOST`                     | Postgres host used by bootstrap scripts                                            |
| `PGPORT`                     | Postgres port used by bootstrap scripts                                            |
| `POSTGRES_SUPERUSER_URL`     | Superuser URL for one-time role/DB bootstrap only (not used by the API at runtime) |
| `HOSPIGO_OWNER_PASSWORD`     | Password for the `hospigo_owner` role                                              |
| `HOSPIGO_APP_PASSWORD`       | Password for the `hospigo_app` role                                                |
| `HOSPIGO_HQ_PASSWORD`        | Password for the `hospigo_hq` role                                                 |
| `DATABASE_URL`               | Runtime app DB URL (`hospigo_app` → `hospigo`)                                     |
| `DATABASE_URL_OWNER`         | Migrate/seed URL (`hospigo_owner` → `hospigo`)                                     |
| `DATABASE_URL_TEST`          | App test DB URL (must use database `hospigo_test`)                                 |
| `DATABASE_URL_OWNER_TEST`    | Owner test DB URL (must use database `hospigo_test`)                               |
| `DATABASE_URL_HQ`            | HQ role URL                                                                        |
| `REDIS_URL`                  | Redis/Memurai URL — use `127.0.0.1`, not `localhost`                               |
| `STORAGE_ROOT_PATH`          | Absolute path to an existing, writable folder **outside** the repo                 |
| `SMTP_HOST`                  | SMTP host                                                                          |
| `SMTP_PORT`                  | SMTP port                                                                          |
| `SMTP_USER`                  | SMTP username                                                                      |
| `SMTP_PASSWORD`              | SMTP password                                                                      |
| `SMTP_FROM`                  | From address for outbound mail                                                     |
| `JWT_SECRET`                 | JWT signing secret (auth Step 6)                                                   |
| `SEED_SUPERADMIN_PASSWORD`   | Dev-seed SuperAdmin password                                                       |
| `SEED_BRANCH_ADMIN_PASSWORD` | Dev-seed Branch Admin password                                                     |
| `SEED_STAFF_PASSWORD`        | Dev-seed staff password                                                            |

## Database setup

These paths and scripts exist in the working tree:

1. Bootstrap roles and databases (idempotent; needs `POSTGRES_SUPERUSER_URL`):

```bash
node scripts/db/create-roles.mjs
```

2. Apply migrations as the owner role:

```bash
npm run prisma:migrate -w @hospigo/api
```

3. Seed reference data; with `NODE_ENV=development` also seeds fake test tenants:

```bash
npm run prisma:seed -w @hospigo/api
```

Generate the Prisma Client when needed:

```bash
npm run prisma:generate -w @hospigo/api
```

Auth, rate limiting, and Mailpit wiring: Not available yet (planned in later steps).

## Run, build, test, lint, format

| Script                                    | Purpose                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `npm run lint`                            | Lint the workspace (Husky pre-commit runs this) |
| `npm run format`                          | Format with Prettier                            |
| `npm run format:check`                    | Check Prettier formatting                       |
| `npm run prepare`                         | Install Husky hooks                             |
| `npm run dev -w @hospigo/api`             | Start the API in watch mode                     |
| `npm run build -w @hospigo/api`           | Generate Prisma Client, then build the API      |
| `npm run start -w @hospigo/api`           | Start the built API                             |
| `npm test -w @hospigo/api`                | Run API tests (DB suites expect `hospigo_test`) |
| `npm run prisma:generate -w @hospigo/api` | Generate Prisma Client                          |
| `npm run prisma:migrate -w @hospigo/api`  | Apply migrations                                |
| `npm run prisma:seed -w @hospigo/api`     | Run seeds                                       |

## Health checks

With the API running (default port from `API_PORT`):

- `GET /health` — liveness only: `{ "status": "ok" }` (no dependency checks)
- `GET /health/details` — dependency probe for `postgres`, `redis`, `storage`, `websocket`, and `queue` (each `up`/`down` with timing; overall `ok` or `degraded`)
- Swagger UI: `GET /docs`

## Working agreement

- Branch from `develop` and open a pull request; never push directly to `main`
- Never commit `.env` or other secrets
- Use conventional commit messages
- Do not bypass Husky hooks
- Run the end-of-step checklist before finishing a step
- Update `docs/CHANGELOG.md` for every step
- If setup, env keys, scripts, or run steps change, update this README in the same commit

## Troubleshooting

| Issue                                                  | What to do                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Redis fails when `REDIS_URL` uses `localhost`          | Use `127.0.0.1` instead. Check the port in PowerShell: `Test-NetConnection 127.0.0.1 -Port 6379` |
| Storage health fails / API rejects `STORAGE_ROOT_PATH` | Point it at an absolute folder outside the repo that already exists and is writable              |
| Husky hooks missing after clone                        | Run `npm install` so the root `prepare` script activates Husky                                   |

## CI

GitHub Actions runs lint, format check, API build, DB role bootstrap, and API tests on pushes to `develop` / `feature/**` and on PRs into `develop` / `main`. An `audit` job reports `npm audit` findings without blocking. Details: [docs/ci.md](docs/ci.md).

## Docs index

- [Architecture](docs/architecture.md) — tenancy, DB roles, RLS, Prisma, ledger rules for later
- [Folder guide](docs/folder-guide.md) — where code and scripts live
- [CI](docs/ci.md) — GitHub Actions, PR flow, reading failures
- [Changelog](docs/CHANGELOG.md) — step-by-step project history
