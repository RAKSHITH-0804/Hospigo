# Folder guide

| Path                                           | Purpose                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/api`                                     | NestJS API (`@hospigo/api`)                                              |
| `apps/api/prisma`                              | Prisma schema, migrations, seeds                                         |
| `apps/api/src/modules`                         | Feature modules (health, storage, auth, opd-masters, …)                  |
| `apps/api/src/modules/opd-masters`             | OPD masters/settings services (no controllers yet; Phase 2 Step 2)       |
| `docs/schema-opd.md`                           | OPD schema design + Step 2 as-built notes                                |
| `docs/use-cases-opd.md`                        | OPD use cases                                                            |
| `apps/api/src/modules/auth`                    | Auth endpoints, Redis limiter/lockout, tokens, global AuthGuard          |
| `apps/api/src/modules/patient-auth`            | Patient OTP login (platform accounts; separate DB role)                  |
| `apps/api/src/modules/messaging`               | OTP `MessageProvider` + dev driver                                       |
| `apps/api/src/modules/mail`                    | SMTP provider, templates, BullMQ `mail` enqueue (worker in AuthModule)   |
| `apps/api/scripts/send-activation.ts`          | Dev tooling: enqueue activation email for accessCode+email               |
| `docs/api-auth.md`                             | Auth HTTP endpoint reference (request/response/errors/curl)              |
| `apps/api/src/database`                        | Prisma module, TenantDb, BranchAccessLookup, Hq/Patient Prisma, DB tests |
| `apps/api/scripts`                             | API one-time/ops scripts (e.g. `create-hq-admin.ts`)                     |
| `apps/api/src/generated`                       | Generated Prisma Client (local/CI generate; not edited by hand)          |
| `apps/web`                                     | Next.js web app (`@hospigo/web`)                                         |
| `apps/web/src/config`                          | Web session/cookie config (`session.ts`); module nav map (`modules.ts`)  |
| `docs/env-reference.md`                        | Every API/web env var (names only)                                       |
| `docs/engineering-tracker.md`                  | Roadmap + security layer status                                          |
| `docs/staging-checklist.md`                    | Staging / first-live checklist                                           |
| `apps/web/src/app/api/auth`                    | BFF staff/HQ auth route handlers (cookies; server→API)                   |
| `apps/web/src/app/api/patient-auth`            | BFF patient OTP auth (separate cookies; server→API)                      |
| `apps/web/src/app/patient`                     | Patient login + home (no staff AppShell)                                 |
| `apps/web/src/app/forgot-password`             | Forgot-password page (hospital / HQ tabs)                                |
| `apps/web/src/app/reset-password`              | Reset-password page (hash token → BFF)                                   |
| `apps/web/src/app/activate`                    | Activation page (hash token → BFF)                                       |
| `apps/web/src/app/api/health`                  | BFF health probe (server→API via `API_INTERNAL_URL`)                     |
| `apps/web/src/instrumentation.ts`              | Production startup checks (`APP_URL`, `API_INTERNAL_URL`)                |
| `apps/web/src/lib/auth`                        | Session helper, guards, module guard, upstream client, cookie helpers    |
| `apps/api/src/config/production-seed-guard.ts` | Dev-seed allow + production `isTest` refuse                              |
| `apps/web/src/mock`                            | Clearly fake concept-screen data (Step 5b; replace with APIs later)      |
| `apps/web/src/components`                      | Shared UI (shell, states, concept screens)                               |
| `packages/shared`                              | Shared package placeholder                                               |
| `scripts/db`                                   | Labelled DB bootstrap scripts (e.g. create-roles)                        |
| `docs`                                         | Architecture and operational docs                                        |
| `docs/ui-concepts.md`                          | Four concept screens (from PDF + Step 5b corrections)                    |
| `docs/ci.md`                                   | GitHub Actions CI, PR flow, how to read failures                         |
| `.github/`                                     | Workflows, Dependabot, pull request template                             |
| `.nvmrc`                                       | Node major for this repo (`22`)                                          |

Do not add stray files at the repo root. Throwaway probes belong under `scripts/` and must be labelled.
