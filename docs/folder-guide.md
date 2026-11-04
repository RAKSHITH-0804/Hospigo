# Folder guide

| Path                     | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `apps/api`               | NestJS API (`@hospigo/api`)                                     |
| `apps/api/prisma`        | Prisma schema, migrations, seeds                                |
| `apps/api/src/modules`   | Feature modules (health, storage, …)                            |
| `apps/api/src/database`  | Prisma module + DB security tests                               |
| `apps/api/src/generated` | Generated Prisma Client (local/CI generate; not edited by hand) |
| `apps/web`               | Web workspace placeholder                                       |
| `packages/shared`        | Shared package placeholder                                      |
| `scripts/db`             | Labelled DB bootstrap scripts (e.g. create-roles)               |
| `docs`                   | Architecture and operational docs                               |

Do not add stray files at the repo root. Throwaway probes belong under `scripts/` and must be labelled.
