# Folder guide

| Path                                           | Purpose                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/api`                                     | NestJS API (`@hospigo/api`)                                                 |
| `apps/api/prisma`                              | Prisma schema, migrations, seeds                                            |
| `apps/api/src/modules`                         | Feature modules (health, storage, auth, opd-masters, patients, …)           |
| `apps/api/src/modules/opd-masters`             | OPD masters/settings services (Phase 2 Step 2)                              |
| `apps/api/src/modules/numbering`               | Bill/receipt/refund + token counter services (Step 3a)                      |
| `apps/api/src/modules/patients`                | UHID + patient registry HTTP API (Step 3a)                                  |
| `apps/api/src/modules/access`                  | AccessService + PermissionGuard / permission decorators                     |
| `apps/api/src/common/phone.normalize.ts`       | Shared Indian mobile normalize (used by patient-auth + registry)            |
| `apps/api/src/modules/auth`                    | Auth endpoints, Redis limiter/lockout, tokens, global AuthGuard             |
| `apps/api/src/modules/patient-auth`            | Patient OTP login (platform accounts; separate DB role)                     |
| `apps/api/src/modules/messaging`               | OTP `MessageProvider` + dev driver                                          |
| `apps/api/src/modules/mail`                    | SMTP provider, templates, BullMQ `mail` enqueue (worker in AuthModule)      |
| `apps/api/scripts/send-activation.ts`          | Dev tooling: enqueue activation email for accessCode+email                  |
| `apps/api/src/database`                        | Prisma module, TenantDb, BranchAccessLookup, Hq/Patient Prisma, DB tests    |
| `apps/api/scripts`                             | API one-time/ops scripts (e.g. `create-hq-admin.ts`)                        |
| `apps/api/src/generated`                       | Generated Prisma Client (local/CI generate; not edited by hand)             |
| `apps/web`                                     | Next.js web app (`@hospigo/web`)                                            |
| `apps/web/src/config`                          | Web session/cookie config (`session.ts`); module nav map (`modules.ts`)     |
| `apps/web/src/app/api/auth`                    | BFF staff/HQ auth route handlers (cookies; server→API)                      |
| `apps/web/src/app/api/patient-auth`            | BFF patient OTP auth (separate cookies; server→API)                         |
| `apps/web/src/app/patient`                     | Patient login + home (no staff AppShell)                                    |
| `apps/web/src/app/forgot-password`             | Forgot-password page (hospital / HQ tabs)                                   |
| `apps/web/src/app/reset-password`              | Reset-password page (hash token → BFF)                                      |
| `apps/web/src/app/activate`                    | Activation page (hash token → BFF)                                          |
| `apps/web/src/app/api/health`                  | BFF health probe (server→API via `API_INTERNAL_URL`)                        |
| `apps/web/src/instrumentation.ts`              | Production startup checks (`APP_URL`, `API_INTERNAL_URL`)                   |
| `apps/web/src/lib/auth`                        | Session helper, guards, module/permission guards, staff-api, cookie helpers |
| `apps/web/src/config/staff-copy.ts`            | Typed staff UI copy + role labels + page titles                             |
| `apps/web/src/config/branding.ts`              | Optional Indigo logo hook for the sidebar footer                            |
| `apps/web/src/app/app/patients`                | Patients placeholder page (permission-guarded)                              |
| `apps/web/src/app/app/settings`                | Settings placeholder (`hospital.settings.read`)                             |
| `apps/web/src/components/shell`                | App frame: sidebar, top bar, patient search, user menu, PoweredBy           |
| `apps/web/src/components/ui/tooltip.tsx`       | Accessible hover/focus tooltip (no new dependency)                          |
| `apps/api/src/config/production-seed-guard.ts` | Dev-seed allow + production `isTest` refuse                                 |
| `apps/web/src/mock`                            | Clearly fake concept-screen data (Step 5b; replace with APIs later)         |
| `apps/web/src/components`                      | Shared UI (shell, states, UI kit, concept screens)                          |
| `packages/shared`                              | Shared package placeholder                                                  |
| `scripts/db`                                   | Labelled DB bootstrap scripts (e.g. create-roles)                           |
| `.github/`                                     | Workflows, Dependabot, pull request template                                |
| `.nvmrc`                                       | Node major for this repo (`22`)                                             |

## The docs folder

| Path                          | Purpose                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `docs/README.md`              | Index: which file is for what, and where new notes go                              |
| `docs/handoff-phase2.md`      | CURRENT STATE: done, next, open questions (read first)                             |
| `docs/engineering-tracker.md` | Step table and status                                                              |
| `docs/project-context.md`     | What Hospigo is and every decision behind it                                       |
| `docs/CHANGELOG.md`           | One entry per step                                                                 |
| `docs/decisions/`             | One decisions file per step (`decisions-7e.md`, ...)                               |
| `docs/reference/`             | API references, schema, architecture, system design, env variables, CI, this guide |
| `docs/guides/`                | Dev commands, demo accounts, staging checklist                                     |
| `docs/design/`                | `ui-design.md` (current screen rules), concept screens (history), concept PDF      |
| `docs/plans/`                 | OPD first-flow plan, use cases, future Lab and Pharmacy notes                      |

Do not add stray files at the repo root. Throwaway probes belong under `scripts/` and must be labelled.
