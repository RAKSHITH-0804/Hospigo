# Folder guide

| Path                        | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `apps/api`                  | NestJS API (`@hospigo/api`)                                            |
| `apps/api/prisma`           | Prisma schema, migrations, seeds                                       |
| `apps/api/src/modules`      | Feature modules (health, storage, auth, …)                             |
| `apps/api/src/modules/auth` | Auth endpoints, Redis limiter/lockout, tokens, global AuthGuard        |
| `docs/api-auth.md`          | Auth HTTP endpoint reference (request/response/errors/curl)            |
| `apps/api/src/database`     | Prisma module, TenantDb, BranchAccessLookup, HqPrismaService, DB tests |
| `apps/api/scripts`          | API one-time/ops scripts (e.g. `create-hq-admin.ts`)                   |
| `apps/api/src/generated`    | Generated Prisma Client (local/CI generate; not edited by hand)        |
| `apps/web`                  | Next.js web app (`@hospigo/web`)                                       |
| `apps/web/src/mock`         | Clearly fake concept-screen data (Step 5b; replace with APIs later)    |
| `apps/web/src/components`   | Shared UI (shell, states, concept screens)                             |
| `packages/shared`           | Shared package placeholder                                             |
| `scripts/db`                | Labelled DB bootstrap scripts (e.g. create-roles)                      |
| `docs`                      | Architecture and operational docs                                      |
| `docs/ui-concepts.md`       | Four concept screens (from PDF + Step 5b corrections)                  |
| `docs/ci.md`                | GitHub Actions CI, PR flow, how to read failures                       |
| `.github/`                  | Workflows, Dependabot, pull request template                           |
| `.nvmrc`                    | Node major for this repo (`22`)                                        |

Do not add stray files at the repo root. Throwaway probes belong under `scripts/` and must be labelled.
