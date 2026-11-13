# Dev accounts (local development only)

Fake accounts created by the dev seed (`npm run prisma:seed -w @hospigo/api`, runs only when `NODE_ENV=development`) and by the HQ admin script. They exist only in local dev databases. **Production gets reference data only: no hospitals, no users, no HQ account until a real HQ admin is created on the server.**

Passwords are never written in this repo. Seed passwords come from `.env` (see below).

## Access codes (staff login only, never shown to patients)

| Hospital          | Branch      | Access code       |
| ----------------- | ----------- | ----------------- |
| Demo North Clinic | Main Branch | `demo-north-main` |
| Demo North Clinic | East branch | `demo-north-east` |
| Demo South Clinic | Main Branch | `demo-south-main` |
| Demo South Clinic | West branch | `demo-south-west` |

## Hospital staff (Hospital staff tab: access code, email, password)

| Email                                 | Works with access code               | Role                                                            | Password env var             |
| ------------------------------------- | ------------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| `superadmin@demo-north.example.test`  | `demo-north-main`                    | SUPER_ADMIN                                                     | `SEED_SUPERADMIN_PASSWORD`   |
| `branchadmin@demo-north.example.test` | `demo-north-main`                    | BRANCH_ADMIN                                                    | `SEED_BRANCH_ADMIN_PASSWORD` |
| `staff@demo-north.example.test`       | `demo-north-main`, `demo-north-east` | SUPER_ADMIN (hospital scope) plus branch admin on both branches | `SEED_STAFF_PASSWORD`        |
| `mustchange@demo-north.example.test`  | `demo-north-main`                    | BRANCH_ADMIN, forced password change                            | `SEED_STAFF_PASSWORD`        |
| `superadmin@demo-south.example.test`  | `demo-south-main`                    | SUPER_ADMIN                                                     | `SEED_SUPERADMIN_PASSWORD`   |
| `branchadmin@demo-south.example.test` | `demo-south-main`                    | BRANCH_ADMIN                                                    | `SEED_BRANCH_ADMIN_PASSWORD` |
| `staff@demo-south.example.test`       | `demo-south-main`, `demo-south-west` | SUPER_ADMIN (hospital scope) plus branch admin on both branches | `SEED_STAFF_PASSWORD`        |
| `mustchange@demo-south.example.test`  | `demo-south-main`                    | BRANCH_ADMIN, forced password change                            | `SEED_STAFF_PASSWORD`        |

A user can log in only with the code of a branch they are assigned to. Any other code gives the same generic error as a wrong password.

## Indigo HQ (Indigo HQ tab: email and password, no access code)

No HQ user is seeded. Create a demo one on your local dev database:

```
npm run create-hq-admin -w @hospigo/api -- <email>
```

The script prints a random one-time password once (copy it from the terminal, never into chat or Git). The first login forces a password change. Example email used in dev: `hqdemo@indigo-demo.example.test`.

## OPD mock staff (Phase 2 Step 2; same `SEED_STAFF_PASSWORD`)

Invented emails only. Roles Receptionist / Nurse / Doctor get `opd.masters.read` (not price/settings write).

| Hospital code | Emails                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DEMO_NORTH    | `doctor1@…` … `doctor5@demo-north.example.test`; `receptionist1@…` / `receptionist2@…`; `nurse1@…` / `nurse2@demo-north.example.test` |
| DEMO_SOUTH    | `doctor1@…` … `doctor3@demo-south.example.test`; `receptionist1@…` / `receptionist2@…`; `nurse1@…` / `nurse2@demo-south.example.test` |

Doctor 1 at DEMO_NORTH has availability switch off; one DEMO_SOUTH doctor has leave for tomorrow (IST). Login still uses the branch access codes above.

## Useful to know

- **Open the web app at exactly the host in `APP_URL`** (`http://127.0.0.1:3001` in dev). Cookies are per host, and the Origin check compares against `APP_URL`.
- **Lockout:** 5 failed logins for the same code and email within 15 minutes lock that pair for 15 minutes, with the same generic error. All limits are in `apps/api/src/modules/auth/auth.config.ts`.
- **Reset:** re-running the dev seed resets every seeded user's password to its `SEED_*` value and turns the forced change back on for the `mustchange@` users. It does not touch HQ users.
- **Postman:** a "Hospigo Local" environment holds `baseUrl` and the passwords as current values. Never use Initial values for passwords.

## Check the real data

Run in pgAdmin on the `hospigo` database:

```sql
SELECT h.name AS hospital, b.name AS branch, b.access_code, b.is_main
FROM branches b JOIN hospitals h ON h.id = b.tenant_id
ORDER BY h.name, b.is_main DESC;
```

If this differs from the tables above, the seed was changed, so update this file.
