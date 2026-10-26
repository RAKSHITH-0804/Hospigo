# Hospigo

npm workspaces monorepo for Hospigo. Application and shared packages are placeholders until their implementations are added.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/api` | `@hospigo/api` | API workspace |
| `apps/web` | `@hospigo/web` | Web workspace |
| `packages/shared` | `@hospigo/shared` | Shared code |

Root tooling is TypeScript (`tsconfig.base.json`), ESLint, Prettier, and Husky. Package TypeScript configs should extend `tsconfig.base.json`.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Git Bash on Windows

## Setup

```bash
npm install
cp .env.example .env
```

`.env.example` uses `hospigo.indigocomputers.in` for `APP_URL`, `API_URL`, and `STAGING_URL`. Fill in local `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `SMTP_*`, and `JWT_SECRET` values in `.env`. Do not commit `.env`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run lint` | Lint the workspace. The Husky pre-commit hook runs this. |
| `npm run format` | Format files with Prettier |
| `npm run format:check` | Check Prettier formatting |

## Branches

`main` is the default branch. Day-to-day work happens on `develop`.
