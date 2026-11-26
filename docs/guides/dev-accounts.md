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

## OPD mock staff (Phase 2; same `SEED_STAFF_PASSWORD`)

Invented emails only. Login uses the Access Code of the branch the user is assigned to; any other code gives the same generic error.

| Hospital   | Role         | Email                                           | Access code       | Checked 16 Nov 2026                                     |
| ---------- | ------------ | ----------------------------------------------- | ----------------- | ------------------------------------------------------- |
| DEMO_NORTH | Receptionist | `receptionist1@demo-north.example.test`         | `demo-north-main` | Yes; refused on `demo-north-east` and `demo-south-main` |
| DEMO_NORTH | Receptionist | `receptionist2@demo-north.example.test`         | `demo-north-main` | Yes                                                     |
| DEMO_NORTH | Nurse        | `nurse1@demo-north.example.test`                | `demo-north-main` | Yes                                                     |
| DEMO_NORTH | Nurse        | `nurse2@demo-north.example.test`                | `demo-north-main` | Yes                                                     |
| DEMO_NORTH | Doctor       | `doctor1@demo-north.example.test`               | `demo-north-main` | Yes                                                     |
| DEMO_NORTH | Doctor       | `doctor2@` to `doctor5@demo-north.example.test` | `demo-north-main` | Not individually checked                                |
| DEMO_SOUTH | Receptionist | `receptionist1@demo-south.example.test`         | `demo-south-main` | Yes                                                     |
| DEMO_SOUTH | Receptionist | `receptionist2@demo-south.example.test`         | `demo-south-main` | Not individually checked                                |
| DEMO_SOUTH | Nurse        | `nurse1@demo-south.example.test`                | `demo-south-main` | Yes                                                     |
| DEMO_SOUTH | Nurse        | `nurse2@demo-south.example.test`                | `demo-south-main` | Not individually checked                                |
| DEMO_SOUTH | Doctor       | `doctor1@` to `doctor3@demo-south.example.test` | `demo-south-main` | Not individually checked                                |

What each role gets (from `GET /auth/me`, checked for Receptionist and Nurse):

- Receptionist: `patients.registry.read`, `patients.registry.write`, `opd.masters.read` (no Settings item).
- Nurse: `patients.registry.read`, `opd.masters.read`.
- Doctor: same as Nurse in the seed (not yet checked with `/auth/me`).
- After Step 5a (re-run the dev seed to get them): Nurse also gets `opd.queue.read`, `opd.vitals.read`, `opd.vitals.write`, `opd.notes.read`; Doctor gets those plus `opd.notes.write`.

Doctor 1 at DEMO_NORTH has the availability switch off; one DEMO_SOUTH doctor has leave for tomorrow (IST).

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

- **Open the web app at exactly the host in** `APP_URL` (`http://127.0.0.1:3001` in dev). Cookies are per host, and the Origin check compares against `APP_URL`.
- **Lockout:** 5 failed logins for the same code and email within 15 minutes lock that pair for 15 minutes, with the same generic error. All limits are in `apps/api/src/modules/auth/auth.config.ts`.
- **Reset:** re-running the dev seed resets every seeded user's password to its `SEED_`* value and turns the forced change back on for the `mustchange@` users. It does not touch HQ users.
- **Postman:** a "Hospigo Local" environment holds `baseUrl` and the passwords as current values. Never use Initial values for passwords.
- **Dual roles:** staff@demo-north.example.test and staff@demo-south.example.test ("Seed Staff Dual") hold two roles on purpose, so the user menu shows two badges.

## Check the real data

Run in pgAdmin on the `hospigo` database:

```sql
SELECT h.name AS hospital, b.name AS branch, b.access_code, b.is_main
FROM branches b JOIN hospitals h ON h.id = b.tenant_id
ORDER BY h.name, b.is_main DESC;
```

If this differs from the tables above, the seed was changed, so update this file.

## Step 5b click path accounts

For the nurse and doctor screens use `nurse1@demo-north.example.test` and `doctor2@demo-north.example.test` (access code `demo-north-main`), plus `receptionist1@demo-north.example.test` to create the visits. Re-run the dev seed once after pulling Step 5a so these roles hold the queue, vitals and notes permissions. Doctor 1 has the availability switch off, so use doctor 2 to 5.

After Step 5b the dev Receptionist role also holds `opd.queue.read`: reception sees the whole branch queue (read only). Re-run the dev seed to get it.

## Step 7c additions

- After re-running the dev seed: the Doctor role also gets `opd.doctors.own` (My profile); SuperAdmin and Branch Admin get `opd.doctors.read` and `opd.doctors.write` (the Doctors settings page). SuperAdmin and Branch Admin never get `opd.doctors.own` (they have no doctor profile).
- Demo doctors have FAKE profile details (qualifications, speciality, `DEMO-REG-000n`) so the prescription has something to print, except **doctor 2** of each hospital, which stays empty to show the reminder. The seed fills details only while empty, so it never overwrites what you typed.

## Step 7d additions

- After `npm run prisma:migrate -w @hospigo/api` and the dev seed: the Branch Admin role no longer holds `role.write` (only the SuperAdmin makes roles). New people added on the Staff page get a random password and an activation email; the activation link sets their own password. Test people made by the Postman 7d collection use `pm7d.test@demo-north.example.test` (switched off at the end).
- My profile is open to every demo login, including Receptionist and Nurse; Staff and Roles appear only for people with `user.read` or `role.read` (both Admin roles).

## Step 7e additions

- After `npm run prisma:migrate -w @hospigo/api` and a restart (no seed change): the SuperAdmin of a demo hospital uploads the logo (Settings, Logo); Doctors upload their own signature or stamp in My profile; Receptionist and Nurse can only see the logo through the printed documents. Test pictures made by the Postman 7e collection are removed at its end (they stay on record).

## Indigo people (Step 2.1b; the sign-in form with an EMPTY access code)

When `SEED_INDIGO_PASSWORD` is set in `.env`, the dev seed creates two fake Indigo accounts (never in production):

- `owner@indigo-demo.example.test`: Indigo Owner, may enter every hospital with full power.
- `employee@indigo-demo.example.test`: Indigo Employee, assigned to Demo North only; configuration and data loading, no patient data.

Both use the password in `SEED_INDIGO_PASSWORD`. Sign in with the access code left empty, choose a hospital on the Hospitals page. In Postman add `indigoPassword` to the Hospigo Local environment.
