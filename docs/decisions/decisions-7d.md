# Decisions, Step 7d (staff and roles, My profile for everyone): migration, API and web

Branch: `feature/phase2-step-7-reports-print-api` (7d is built on top of Steps 7, 7b and 7c; one pull request for all). Built 21 to 24 Nov 2026.

## Answers from Rakshith (planning, 21 Nov)

- Staff management is needed for every department: reception, nurses, doctors, lab, pharmacy, clerks, maids and others. **Only an Admin or SuperAdmin adds people.** HQ creates only the SuperAdmin of a hospital (a later HQ step); the SuperAdmin creates Branch Admins and all other staff and roles.
- The **staff code is "Dynamic"**: each hospital chooses its own start letters and number of digits (prefix and least width), the number only goes up.
- **My profile exists for every role** (not only doctors), with sections that fit the role. A person may change **all** their own details (name, phone, email) and their password. Changing the email needs a code sent to the NEW address; changing the password needs the person's own email address typed, a code sent to it, and the new password. The password change happens inside My profile.
- The medical council name stays on hold (question for the manager). The signature or stamp image waits for image and logo upload (7e). HQ hospital creation is a separate HQ step. "Doctor setup" (fees, timings, leave) is a separate step after 7d.

## What was built

Database (`20261124090000_staff_and_roles`): `users.phone` (optional, checked `^[0-9+ ()-]{7,20}$`); new table `staff_code_settings` (one row per hospital: `prefix` default `STF`, `min_width` default 3, `last_number`; checks; row level security enabled and forced; policy `staff_code_settings_app_all`; grants). The migration is new (an earlier migration was already pushed).

New permission handling: `role.write` is now in `ADMIN_EXCLUDED_PERMISSION_CODES`, so a Branch Admin never makes roles (only a SuperAdmin does). The permissions `user.read`, `user.write`, `role.read`, `role.write` already existed.

API, module `staff` (all `@TokenKinds('HOSPITAL')`, deny by default):

| Route                                              | Permission                | What it does                                                                                               |
| -------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /staff` (`q`, `status`, `page`, `pageSize`)   | `user.read`               | Staff the caller may see (a Branch Admin: people of their own branches), with `editable`, `isYou`          |
| `GET /staff/options`                               | `user.read`               | Roles (each `assignable` or the reason not), branches, `canHospitalScope`, `canWrite`, code format, limits |
| `GET /staff/code-format`                           | `user.read`               | Prefix, digits and a sample of the next code                                                               |
| `PUT /staff/code-format`                           | `hospital.settings.write` | Change the format (hospital-wide Admin only; others `403`)                                                 |
| `POST /staff`                                      | `user.write`              | Add a person; code made by the system; activation email sent; answer `{staff, activationSent}`             |
| `PUT /staff/:id`                                   | `user.write`              | Name, email, phone; `branchIds` and `roles` must be sent together                                          |
| `POST /staff/:id/deactivate` and `/reactivate`     | `user.write`              | Switch off or on; switching off ends the person's sessions at once; nothing is deleted                     |
| `POST /staff/:id/resend-invite`                    | `user.write`              | New activation email, only before a password is set, one a minute; answer `{activationSent}`               |
| `GET /roles`, `/roles/catalog`, `/roles/templates` | `role.read`               | Roles with permission codes and holder counts, every permission with plain text, ready-made roles          |
| `POST /roles`, `PUT /roles/:id`                    | `role.write`              | Make or change a role of the hospital (SuperAdmin only)                                                    |
| `POST /roles/:id/deactivate` and `/reactivate`     | `role.write`              | A role nobody holds can be switched off; roles are never deleted                                           |

API, module `account` (`@AuthenticatedOnly`, hospital tokens only; the person is always found from the token):

| Route                                           | What it does                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /account/me`                               | Code, name, email, phone, branches, roles, `isDoctor`, limits                                        |
| `PUT /account/me`                               | Name and phone (anything else in the body is ignored; an empty body is `400`)                        |
| `POST /account/email/request` and `/confirm`    | Code to the NEW address, then the change; the old address works until the code is confirmed          |
| `POST /account/password/request` and `/confirm` | Code to the person's OWN address (the typed one must match), then the new password; all sessions end |

Error codes added: `STAFF_CONFLICT` (`409`, reasons `SELF`, `LAST_SUPER_ADMIN`, `ROLE_IN_USE`, `SYSTEM_ROLE`, `ALREADY_ACTIVE`, `INACTIVE`, `TRY_AGAIN`), `OTP_INVALID` (`400`, reasons `EXPIRED`, `WRONG_CODE`, `TOO_MANY_TRIES`), `RATE_LIMITED` (`429`, `retryAfterSec`).

Web: Settings pages **Staff** (`user.read`) and **Roles** (`role.read`), with help blocks; **My profile** (`/app/profile`) for every signed-in staff member (details, email change, password change, then the doctor part when the person has `opd.doctors.own`); the user menu shows My profile for everyone. Route handlers under `/api/staff/people`, `/api/staff/roles`, `/api/staff/account` (same-origin check, JSON type, branch guard, JSON 401/403, fixed action and step lists). The error wording is in `staffCopy.staffAdmin.errors`.

## Rules decided while building (not in the plan)

- **Who may give which role (delegation rule).** A role can be given only if the caller holds every permission in it on all target branches, OR the permission is a daily-work permission (`FLOOR_PERMISSION_CODES`: reception, nurse and doctor work). The Admin roles are kept away from those on purpose, yet an Admin must be able to staff a reception. The two system roles and a hospital-wide scope need a hospital-wide Admin. Nobody can give a power they do not hold themselves.
- **Reach of a Branch Admin.** They see and change only people whose active branches are all within their own, who hold no hospital-wide role. A person outside the reach is `404`.
- **Nobody edits their own roles or branches, or switches themselves off** (`409 SELF`). A person may change their own name, email and phone (through My profile).
- **The last SuperAdmin stays** (`409 LAST_SUPER_ADMIN`) for both demoting and switching off.
- **Roles.** The two system roles (SuperAdmin, Branch Admin) are fixed. A custom role cannot be switched off while people hold it (`ROLE_IN_USE`). Role names are unique per hospital; limits come from `staff.config.ts` (50 custom roles, 200 permissions, name 60, description 200).
- **Grant check uses `permittedBranches`, not `branchesFor`.** `branchesFor` is narrowed to the branch of the token, which made a SuperAdmin look as if they lacked `role.write` on other branches. A bug found by the tests and fixed.
- **Doctor profile follows the role.** Giving a role that holds `opd.doctors.own` creates the doctor profile (code `DR001`...), or switches an old one on again.
- **Staff code.** `staff_code_settings` per hospital; the counter is raised atomically and skips codes already used, so a code never repeats. Existing codes never change when the format changes.
- **Activation.** A new person gets a random unusable password and `mustChangePassword`; the activation email (existing flow) lets them set their own. `INVITED` means no password set yet.
- **Codes for My profile (OTP).** The code is made in the API and only its HMAC is kept in Redis (single use, time limit and wrong-try limit from the auth config); it is sent straight through `MAIL_PROVIDER`, never through the mail queue, so a code never sits in a queue payload. Requests are limited per person, per hour and per IP (the existing OTP limits are reused). A weak new password is refused before the code is used, so a typo does not burn the code. The password change ends every session of the person (the access token has no session id, so it ends by expiry, within 15 minutes).
- **Switched-off people are refused on account routes too (401).** These routes ask for no permission, so each call checks the account is still on (found by the self-review; test added).
- **Audit stores kinds, not values:** `ACCOUNT_CHANGE {changed:['name','phone']}`, `ACCOUNT_EMAIL_CHANGE`, `ACCOUNT_PASSWORD_CHANGE`, and `STAFF_*` entries with field names only.
- **Web.** The staff list uses the same card grid as the Doctors page (side by side on wide screens, stacked on a phone); search waits `staffScreenConfig.searchDebounceMs`; Switch off asks "Yes / Cancel" first; the code format card sits beside the list; role editor groups permissions by area with ready-made starts; after a password change the screen signs this browser out and goes to sign-in with the usual "password updated" note.
- **The settings pages still need `hospital.settings.read`** for the page frame (both Admin roles have it); a person with `user.read` but without it does not see Staff.

## Adversarial self-review (review gate: permissions, tenant isolation, tokens)

How it could be attacked or break, and what covers it:

| Attack or failure                                                  | Covered by                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Branch Admin gives themself or a friend the SuperAdmin role        | API tests: system roles and hospital scope refused (`NOT_ALLOWED`); `SYSTEM_ROLE` in options                    |
| Admin gives a role with powers they do not hold                    | API tests (`NOT_ALLOWED` when giving a role); only a SuperAdmin makes roles at all (Branch Admin `403`)         |
| Person from another hospital or branch is read or changed          | API tests: `404`, record untouched; RLS sample row for `staff_code_settings`                                    |
| Person edits own roles, switches self off, removes last SuperAdmin | API tests (`SELF`, `LAST_SUPER_ADMIN`)                                                                          |
| Replayed or shared code, someone else's code, two confirms at once | Account tests: single use, wrong person, three parallel confirms (one wins), 5 wrong tries end the code         |
| Code for the password used for the email (or the reverse)          | Account test: purpose is part of the key and the HMAC                                                           |
| Email taken between request and confirm; mail cannot be sent       | Account tests (`DUPLICATE`, `503` and no code left behind)                                                      |
| Password never reaches logs, audit or the mail                     | Account tests (audit has only `['password']`, mail text checked)                                                |
| Sessions after a password change or switching off                  | Account and staff tests (sessions revoked); switched-off token refused on account routes (added by this review) |
| Patient or HQ token, no token, branch changed in another tab       | API tests (401 on every route); web route tests (stale branch header `409`)                                     |
| Hostile id or action in the URL (`../roles/r1`, `delete`)          | Web route tests: the id is encoded, only listed actions and steps are passed on                                 |
| Race: two staff added at once get the same code                    | Staff tests (atomic counter, codes unique)                                                                      |

Not covered by automatic tests: a real email arriving (the collection checks only the refusals; the OTP success path is tested with a fake mail provider); the access token of a person who is switched off stays valid for the account routes only until expiry for anything that asks for no permission (all permission routes refuse at once). **Verdict: safe to approve.** No decision is needed from Rakshith.

## Not done (follow-ups)

- Doctor setup screens (fees, timings, leave): separate step after 7d.
- HQ creating a hospital and its first SuperAdmin: separate HQ step.
- Image and logo upload (7e): signature, stamp, hospital logo.
- Medical council name beside the registration number: on hold (manager).
- Moving a person between hospitals is not possible (a person belongs to one hospital).
- Per-branch role scope inside the staff form is by the branches ticked; a different branch set per role is not offered.
- A Branch Admin editing a person who holds a system role is refused for the roles part (system roles need a hospital-wide Admin).
- A full audit-log screen (the entries are written; no screen reads them yet).
- Postman collection `hospigo-7d-staff-roles` written, not run by Claude (needs the dev passwords).
