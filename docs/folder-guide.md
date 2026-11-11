# Folder guide

| Path                     | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `apps/api`               | NestJS API (`@hospigo/api`)                                     |
| `apps/api/prisma`        | Prisma schema, migrations, seeds                                |
| `apps/api/src/modules`   | Feature modules (health, storage, …)                            |
| `apps/api/src/database`  | Prisma module + DB security tests                               |
| `apps/api/src/generated` | Generated Prisma Client (local/CI generate; not edited by hand) |
| `apps/web`               | Next.js web app (`@hospigo/web`)                                |
| `packages/shared`        | Shared package placeholder                                      |
| `scripts/db`             | Labelled DB bootstrap scripts (e.g. create-roles)               |
| `docs`                   | Architecture and operational docs                               |
| `docs/ci.md`             | GitHub Actions CI, PR flow, how to read failures                |
| `.github/`               | Workflows, Dependabot, pull request template                    |
| `.nvmrc`                 | Node major for this repo (`22`)                                 |

Do not add stray files at the repo root. Throwaway probes belong under `scripts/` and must be labelled.
