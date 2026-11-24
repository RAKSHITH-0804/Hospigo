# Hospigo: dev commands (Git Bash, repo root `D:\Indigo\Hospigo Code`)

Keep this file somewhere handy. You can also save it in the repo as `docs/guides/dev-commands.md`.
Everything below comes from the Phase 2 handoff and what we used while building Step 3c.

## 1. Start order (each server in its own terminal)

1. PostgreSQL running (database `hospigo` on `127.0.0.1:5432`).
2. Redis (Memurai) running. Check with the ping command below.
3. Mailpit, only if you need staff emails (OTP, invites, password reset).
4. API.
5. Web.

## 2. Redis (Memurai)

```
memurai-cli -h 127.0.0.1 ping
```

Expected answer: `PONG`. If it does not answer, start the Memurai service from the Windows Services app (I have not seen how you installed it, so I can't give the exact service command).

## 3. Mailpit (only for staff emails)

Run it from PowerShell (not Git Bash) in `D:\Indigo\Tools\mailpit`, or double-click `mailpit.exe`:

```
.\mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
```

- Inbox in the browser: http://127.0.0.1:8025
- SMTP port for the API: 1025

## 4. API (port 3000)

```
npm run dev -w @hospigo/api
```

## 5. Web (port 3001)

```
npm run dev -w @hospigo/web
```

Open the app at **http://127.0.0.1:3001** (never `localhost`).

## 6. Health check

```
curl http://127.0.0.1:3000/health
```

Or in Postman: the `Health` request (`GET {{baseUrl}}/health`).

## 7. Database

```
npm run prisma:migrate -w @hospigo/api
NODE_ENV=development npm run prisma:seed -w @hospigo/api
```

- The migrate command applies pending migrations (it prints "No pending migrations to apply" when up to date).
- The seed needs `NODE_ENV=development`. It is safe to run twice: the patient seed skips when a hospital already has 60 patients.

## 8. Tests, lint, format

```
npm test -w @hospigo/api
npm test -w @hospigo/web
npm run lint
npm run format:check
```

## 9. Production-mode web (to check real page speed)

Stop the web dev server first (the build and the dev server share the same `.next` folder), keep the API running, then:

```
npm run build -w @hospigo/web
npm run start -w @hospigo/web
```

The start command may use a different port. Read the terminal output for the address.

## 10. Ports: what is using one?

```
netstat -ano | grep ":3000"
netstat -ano | grep ":3001"
taskkill //PID <number> //F
```

The last number on a `LISTENING` line is the process id (PID). In Git Bash the double slashes in `taskkill` are needed.

## 11. Postman collections (import once, then Run collection with `Hospigo Local`)

| File                     | What it proves                                                               | Needs                                      |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------ |
| Hospigo-uhid-3c          | Next UHID number read and raise, both hospitals (57 checks)                  | API                                        |
| Hospigo-patients-list-3c | List, sorts, filters, error messages, form-config, registration (101 checks) | API, dev seed                              |
| Hospigo-patients-q-3c    | Free-text `q` search (34 checks)                                             | API, dev seed                              |
| Hospigo-route-safety-3c  | The API refuses missing and wrong tokens and missing permissions             | API, `patientPhone` for the patient checks |

More collections (committed in `postman/collections/`, no secrets inside; the environment file stays on your PC): `hospigo-3d-branch-switch`, `hospigo-4a-opd-visit-billing`, `hospigo-5a-doctor-queue`, `hospigo-5a1-split-payment`, `hospigo-6a-investigations-refunds`, `hospigo-7-reports-print-templates` (report, CSV, print templates) and `hospigo-7b-settings` (OPD rules, registration fields, patient number format; it restores what it changes and registers one patient) and `hospigo-7c-doctor-profile` (doctor profile, Admin corrections, the copy kept on a completed prescription; restores the profile; makes one paid visit) and `hospigo-7e-pictures` (hospital logo and doctor signature: refusals, upload of a 30-byte WebP written as text, who may look, removal; expects a demo hospital with no logo and no signature yet and removes what it makes; pictures stay on record by design) and `hospigo-7d-staff-roles` (staff list, add, change, switch off and on, roles, staff code format, My profile refusals; makes ONE test role and ONE test person that stay switched off, reused by later runs; puts the code format back). They need the `Hospigo Local` environment (`staffPassword`, `superadminPassword`).

After a pull or a seed change, run the dev seed again so roles get new permissions: `$env:NODE_ENV="development"; npm run prisma:seed -w @hospigo/api` (PowerShell), then restart both servers.

Access tokens last 15 minutes. Each collection logs in by itself.

## 12. Demo logins

- Access codes: `demo-north-main`, `demo-north-east`, `demo-south-main`, `demo-south-west`.
- Accounts and roles: `docs/guides/dev-accounts.md`.
- Passwords come from `.env` (`SEED_SUPERADMIN_PASSWORD`, `SEED_BRANCH_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`). Never paste them into chats.

## 13. Before every commit

```
git checkout -- apps/web/next-env.d.ts
npm run format:check
git status --short
```

Check that `.env` is not listed. Never run `npm audit fix --force`. Stop the dev servers before `npm ci`. Use `git --no-pager` for log and diff output.
