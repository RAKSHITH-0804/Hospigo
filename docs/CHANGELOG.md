# Changelog

## How to add an entry

1. Add a new section under **Unreleased** (or promote Unreleased into a dated step when the step commits land).
2. Newest entries stay at the top.
3. Use the template below. Fill every field. If something cannot be verified from git or the repo, write `unverified` — do not guess.
4. Never put passwords, full connection strings, or real hospital names in this file.
5. Commit the changelog update with the step (or in the docs commit that closes the step).

### Entry template

```markdown
## YYYY-MM-DD — Phase X Step Y — <short title>

- **Commit hash(es):** <hashes or unverified>
- **Added:** …
- **Changed:** …
- **Removed:** …
- **Fixed:** …
- **Database (migrations, roles, RLS):** …
- **New .env keys (names only):** …
- **Tests:** <count and coverage, or unverified>
- **Decisions:** …
- **Follow-ups and open items:** …
```

---

## Unreleased

Step 3a (Prisma, base schema, RLS) files exist in the working tree (`apps/api/prisma/`, `scripts/db/create-roles.mjs`, related docs) but have **no commit on `develop` yet**. Treat completion status as **unverified** until create-roles, migrate, seed, and tests are run and commits land.

---

## 2026-11-04 — Phase 1 Step 2 — NestJS API skeleton, health, local-folder StorageService

- **Commit hash(es):** `0a6286b`
- **Added:** NestJS API under `apps/api` (`@hospigo/api`); Swagger at `/docs`; env validation; health module; local-folder `StorageService` (`STORAGE_SERVICE` token + `LocalFolderStorageDriver`); Jest unit + e2e health tests
- **Changed:** Root ESLint TypeScript support; `.env.example` for API/storage; README for storage and API scripts
- **Removed:** MinIO client dependency and MinIO health checker; all `MINIO_*` env keys
- **Fixed:** Queue health check against Redis; Redis URL guidance toward `127.0.0.1`
- **Database (migrations, roles, RLS):** none in this commit
- **New .env keys (names only):** `NODE_ENV`, `API_PORT`, `STORAGE_ROOT_PATH` (and MinIO keys removed)
- **Tests:** 12 tests — local storage driver (put/get/exists/delete, path traversal, absolute paths, tenant prefix, health ok/fail) and health e2e (`/health`, `/health/details`, `/docs`)
- **Decisions:** Object storage is an injectable `StorageService` (local folder now; S3-compatible later). `GET /health` stays liveness-only; `GET /health/details` checks `postgres`, `redis`, `storage`, `websocket`, `queue`
- **Follow-ups and open items:** Auth restriction for `/health/details` (Step 4); Prisma/RLS tenancy (Step 3a)

---

## 2026-10-26 — Phase 1 Step 1 — Monorepo skeleton

- **Commit hash(es):** `2e067a6`
- **Added:** npm workspaces root; placeholder packages `@hospigo/api`, `@hospigo/web`, `@hospigo/shared`; `tsconfig.base.json`; ESLint; Prettier; Husky pre-commit (`npm run lint`); `.env.example`; README; `.cursor/rules/hospigo.mdc`; `docs/.gitkeep`
- **Changed:** n/a (initial skeleton)
- **Removed:** n/a
- **Fixed:** n/a
- **Database (migrations, roles, RLS):** none
- **New .env keys (names only):** `APP_URL`, `API_URL`, `STAGING_URL`, `DATABASE_URL`, `REDIS_URL`, `MINIO_*` (later removed in Step 2), `SMTP_*`, `JWT_SECRET`
- **Tests:** none in this commit
- **Decisions:** Work on `develop`; `main` is default; public domains use `hospigo.indigocomputers.in`; never commit `.env`
- **Follow-ups and open items:** NestJS API skeleton (Step 2)
