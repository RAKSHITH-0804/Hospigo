# Runbook: starting a real hospital

There is **no tool that creates a hospital** (HQ hospital creation is parked and is a go-live blocker in the exit report). Today a hospital is created by a developer with the owner database login. This page says what must exist before the starter script can run, how it is made today, and what the script then does.

## 1. What must exist before the starter script runs

| #   | What                                                                                                                                    | Why                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | A `hospitals` row: unique `code`, `name`, `status ACTIVE`, `isTest false`                                                               | The script finds the hospital by its code                 |
| 2   | The two system roles of the hospital (SuperAdmin, Branch Admin) with their permissions                                                  | Staff, roles and screens depend on them                   |
| 3   | At least one `branches` row with `isMain true` and a unique **access code** per branch                                                  | The access code is part of the sign-in                    |
| 4   | Module subscriptions for the hospital and its branches (OPD switched on)                                                                | The sidebar and API guards need the OPD module            |
| 5   | The first **SuperAdmin user** (code, email, name, password hash), with a membership of the main branch and the SuperAdmin hospital role | Prices, the UHID format and the audit need a real user id |

The script **checks** items 1, 3 and 5 and stops with a plain message if one is missing. It does not create them.

## 2. How a hospital is created today

There is no script for it. The dev seed (`apps/api/prisma/seeds/dev-tenants.ts`, function `seedDevTenants`) is the only code that does it, for the two demo hospitals, and it is the pattern to follow:

1. `hospital.create` (real hospital: `isTest: false`).
2. `ensureSystemRolesForTenant(prisma, hospitalId)` from `prisma/seeds/reference.ts` (SuperAdmin and Branch Admin with their permission lists).
3. `branch.create` for each branch with a real access code (never a `dev-placeholder` code; the audit found those on the demo branches).
4. The module subscriptions and branch modules (`hospitalModuleSubscription`, `branchModule`), OPD on.
5. The first SuperAdmin user with a password hash, then the staff activation mail (`apps/api/scripts/send-activation.ts`) so the person sets their own password. Never type a real password into a script or a chat.

Run it with the **owner** login (`DATABASE_URL_OWNER`), never from the application server. Check the result by signing in with the access code.

## 3. What the starter script does

```powershell
npm run hospital:starter -w @hospigo/api -- --hospital CODE --dry-run
npm run hospital:starter -w @hospigo/api -- --hospital CODE
```

Run `--dry-run` first: it prints what it would create and changes nothing. It never creates patients, doctors, users, visits or prices, and it never overwrites a value an Admin already changed. It is safe to run twice.

Created when missing: payment modes (Cash, UPI, Card), vitals fields, the BILL, RECEIPT and REFUND number series, the OPD rules row, the "Registration" charge item (without a price), the patient registration field settings and a default UHID format.

## 4. What is still needed before the first visit

After the starter script, an Admin or SuperAdmin must set:

1. The **registration fee** price (Settings, OPD, Prices).
2. Each **doctor's fee** for NEW and for FOLLOW_UP (Prices, or the Excel upload "Doctor fees"). The doctors exist first (Settings, Staff, role Doctor).
3. The test prices and the medicine list if wanted (Settings, OPD, Upload lists).
4. The **last UHID number** if the hospital already has patients (Settings, Patients, Patient numbers: raise-only, with a reason).

Without a registration price and a doctor fee, the first visit is refused with `409 FEE_NOT_CONFIGURED`.

## 5. Doctor availability (optional)

A new doctor is **available at once** (the switch defaults to on) and has no weekly times and no leave, so reception can pick the doctor straight away. To change this, an Admin opens Settings, Doctors and presses **Availability** on the doctor: the switch (off stops the doctor being picked), the weekly times per branch (they only warn at the desk) and leave days (they stop the doctor being picked on those days).
