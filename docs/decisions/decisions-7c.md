# Decisions, Step 7c (doctor profile setup): migration, API and web

Branch: `feature/phase2-step-7-reports-print-api` (7c is built on top of Step 7 and 7b; one pull request for all). Built 21 Nov 2026.

## Answers from Rakshith (planning, 21 Nov)

- Management questions: defaults accepted (a doctor edits their own details and an Admin can correct them; the registration number is trusted, no "verified" tick; a prescription prints without a registration number but reminds the doctor to fill it in; one profile per doctor for all branches; the details copy taken at completion is what prints).
- The **signature or stamp image waits for image and logo upload** (not in 7c).
- The **medical council name is on hold**: it goes to the manager with the other questions (see the handoff).
- Department: editable, by an Admin only (it decides the collection report). Name as printed: an optional field. Old prescriptions (completed before 7c) print the doctor's current details.
- SuperAdmin can correct any doctor in the hospital; a **Branch Admin only doctors who work in their own branch**.
- Staff management (adding users and roles) is a separate, bigger step: see "Next" below.

## What was built

Database (`20261123090000_doctor_profile_details`): `doctor_profiles` gets `printed_name`, `qualifications`, `speciality`, `registration_no` (all optional, length checked: 80, 150, 80, 40). `consultations` gets `doctor_details` (JSON). **The database takes the copy**: when a note becomes COMPLETED the guard trigger reads the doctor's profile and login name and writes the copy itself. The app role has no UPDATE right on the column, and the insert trigger clears any value handed in, so the copy cannot be forged and an old prescription never changes. Notes completed before 7c have no copy and show the live profile.

API (new module `doctor-profiles`):

| Route                      | Permission                | What it does                                                                              |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /doctor-profiles/me`  | `opd.doctors.own` (OPD)   | The signed-in doctor's profile (found from the token user) with `missing` and `limits`    |
| `PUT /doctor-profiles/me`  | `opd.doctors.own` (OPD)   | Printed name, qualifications, speciality, registration number (never the department)      |
| `GET /doctor-profiles`     | `opd.doctors.read` (OPD)  | Doctors the caller may see, with details, branch names, `canWrite`, `limits`              |
| `PUT /doctor-profiles/:id` | `opd.doctors.write` (OPD) | An Admin corrects a doctor, including the department; a doctor outside the scope is `404` |

`GET /opd/visits/:id/consultation` and the complete answer now carry `doctorDetails` (`name`, `printedName`, `printName`, `department`, `qualifications`, `speciality`, `registrationNo`, `fromCompletedCopy`). Audit `DOCTOR_PROFILE_CHANGE` stores the field names and whether it was the doctor themselves, never the text.

New permissions: `opd.doctors.own` (the Doctor role in the dev seed; kept off both Admin roles, which have no doctor profile), `opd.doctors.read` and `opd.doctors.write` (both Admin roles through the normal grant-all rule). Re-run the seed after pulling.

Web: **My profile** (`/app/profile`, from the user menu for people with `opd.doctors.own`), the **Doctors** settings page (`/app/settings/doctors`, needs `opd.doctors.read`), a reminder on the consultation screen when the registration number is empty (never blocks Complete), and the prescription print now fills the doctor lines from `doctorDetails`. Both new pages have the "About this page" help block.

## Decisions made while building (not in the plan)

- **Scope of an Admin:** `AccessService.hospitalWideBranches` (a hospital-wide grant) reaches every doctor of the hospital; otherwise `permittedBranches` and the doctor's active branch memberships decide. A doctor who works in two branches can be corrected by the Admin of either. A doctor outside the scope is 404, not 403, so nothing leaks.
- **A doctor's own profile is found from the token's user** (`user_id`), never from the request body or URL. A login with the permission but no active profile gets `403 DOCTOR_PROFILE_REQUIRED`.
- **Fields:** text is trimmed, repeated spaces become one, empty text or `null` clears a field. The registration number allows letters, digits, spaces and `. / ( ) , -` only. Control characters are refused everywhere. Fields not on the list (id, user, tenant, code, active) are ignored.
- **The login name stays in the copy** (`name`) so the print falls back to it when there is no printed name.
- **Demo data:** the dev seed fills FAKE details (`DEMO-REG-000n`) for the demo doctors, only while empty so a reseed never overwrites typed values. Doctor 2 of each hospital stays empty to show the reminder.
- **No signature box content yet:** the `doctorSignature` print field stays empty until image upload exists.

## Self-review (adversarial pass, review gate: permissions)

Verdict: **safe to approve**, with two notes.

- Covered by tests: no token and patient token on every route; a doctor (own permission only) cannot list or correct another doctor; an Admin without the own permission has no "my profile"; reading and correcting are separate permissions; a Branch Admin reaches only doctors of their own branch (others are 404 and untouched); another hospital's doctor, an unknown id and a junk id are 404; the body cannot choose the doctor, hospital, user, code or active flag; the department is Admin-only; injection-style, over-long and control-character values are refused; refused changes leave no audit trail; the audit never contains typed text; two saves at once leave one whole result and no error; the copy is made by the database, the app role cannot write it, an insert cannot bring one, a forged copy at completion is replaced, a completed prescription does not change when the profile changes, and a second click on Complete returns the same copy.
- Not covered: the real browser (typing, the user-menu link, the reminder link) by an automated test; the Postman collection was not run by the assistant.
- **Note 1 (deployment):** a new permission reaches the system roles of a hospital when the seed runs. Existing hospitals in production need the seed (or a small script) run once after deploy so their Admins get `opd.doctors.read` and `opd.doctors.write`, and their own Doctor roles need `opd.doctors.own` added (the staff and roles step will make this a screen).
- **Note 2:** a Branch Admin can correct a doctor who also works in another branch (the doctor's details are not per branch, by decision).

## Tests

API: 22 doctor profile endpoint tests, 4 new clinical tests (copy at completion). Web: my-profile form, doctors list, 2 routes, the pages, the user menu link, the consult reminder, the print of the doctor details, help text. Postman: `postman/collections/hospigo-7c-doctor-profile.postman_collection.json` (34 requests; restores the profile it changes; makes one paid visit and one completed prescription). Not run by the assistant.

## Not done (follow-ups)

- The **medical council name** (on hold, a question for the manager).
- The **signature or stamp image** (needs image upload).
- Adding doctors (login, profile, fees, timings): part of the staff step.
- A per-doctor letterhead layout (a future upgrade).
- Showing a "profile incomplete" tag on the Doctors list for the reminder fields beyond the registration number only on the consult screen.

## Next: staff and roles (recommended placement)

Rakshith wants every hospital to add its own staff (doctors, nurses, reception, lab, pharmacy, clerks and others). HQ creates the hospital and its SuperAdmin; the SuperAdmin creates the Branch Admins, roles and staff. Recommendation: **Step 7d, "Staff and roles", straight after 7c** and before image upload (7e) and the NestJS upgrade (8a), because no real hospital can go live without it and it needs the permissions model to be settled (done). Planned scope: create and deactivate users with the existing email activation flow, assign roles with a hospital or branch scope, create custom roles by picking permissions, a doctor gets a profile when given the Doctor role, and guard rails (an Admin cannot grant what they do not hold; the last SuperAdmin cannot be removed; everything audited). This is a review gate (permissions, tenant isolation) and needs its own plan and questions.
