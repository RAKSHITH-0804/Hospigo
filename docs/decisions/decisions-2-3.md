# Decisions: Phase 2.3, Part 1 (Rakshith's change list of 27 Nov 2026)

Branch `feature/step-2-3-feedback` (from `feature/step-2-2c-ui-redesign`, not pushed). Part 2 (speed and load test) follows.

## What was built and why

| #    | Change                                                            | How it works                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Age is one number, in years                                       | The months and days boxes are gone from the registration form; a baby is entered with the date of birth.                                                                                                                                                                     |
| 2    | Collapsed sidebar                                                 | The icon is centred and the "6" badge sits on the icon's corner (`design.css`).                                                                                                                                                                                              |
| 3    | **View** design                                                   | `GET /print-library/templates/:id` (needs `print.templates.choose`; the database shows only designs assigned to the hospital). Settings, Print designs has a **View** button that opens a sample in a window. Admin and Super Admin both see it.                             |
| 4    | Password reset by Super Admin or Admin                            | `POST /staff/:id/reset-password`, see the rules below.                                                                                                                                                                                                                       |
| 5, 6 | **Administration** menu                                           | Staff, Roles and Doctors (with Leave requests) live at `/app/administration/...`. Settings keeps configuration only. Old `/app/settings/staff` and the others redirect. The menu item shows for people with `user.read`, `role.read` or `opd.doctors.read`.                  |
| 7    | Quick view (Patients)                                             | Initials, name and a one-line summary, the facts in two columns, then the buttons. Existing fields only.                                                                                                                                                                     |
| 8    | Graphs responsive and clickable                                   | HTML bars that grow with the card. A day opens the Collection report of that day, a payment mode or a doctor opens the report filtered (`?paymentMode=`, `?doctor=`). Only for people who hold `opd.reports.read`.                                                           |
| 9    | Attention required smaller                                        | One compact line per item, side by side when there is room.                                                                                                                                                                                                                  |
| 10   | Module tiles removed; small blocks are the links                  | Each KPI block links to its screen when the person may open it (queue, report, refunds, patients). Others stay plain.                                                                                                                                                        |
| 11   | Own calendar in Patient Register                                  | The app's calendar with month and year dropdowns replaces the browser's date box.                                                                                                                                                                                            |
| 12   | Receipt: the middle ₹600 removed                                  | The sample bill designs no longer print the "Payment: Cash ₹600" line (the amount in the middle). "Total" and "Paid" stay. **Existing hospitals keep their copy until the design is chosen again** (or `npm run dev:reset` for the dev database).                            |
| 13   | Nurse vitals show their values                                    | The box holds the saved value; only changed values are sent, and a change still asks for a reason (history is kept).                                                                                                                                                         |
| 14   | Vitals locked after the consultation is completed                 | The API refuses vitals writes when the visit is COMPLETED (`VITALS_VISIT_NOT_OPEN`); the page says so; the queue shows "Vitals (view)".                                                                                                                                      |
| 15   | Reception and Nurse print the prescription and the patient report | New permission `opd.prints.clinical` and route `GET /opd/visits/:id/print-data` (note and vitals of a COMPLETED visit, audited like a note read). Role templates and the demo seeds give it to Receptionist and Nurse. Queue rows of completed visits get two print buttons. |
| 16   | **Billed by** on bills and receipts                               | The bill view carries the name and role of the person who saved the bill (`billedBy`, for every bill type). A new value "Billed by" is in the designed bills.                                                                                                                |

## Rules for the password reset (#4; Rakshith's answers)

- A **Super Admin** may reset anyone except themselves. An **Admin** may reset staff of their own branches, never a Super Admin (that answers 404, as if the person did not exist), never themselves.
- The link is the usual one-time reset link, sent to the email on file. No password is made or shown.
- **My safety additions:** refused (409 `EMAIL_JUST_CHANGED`) when the person's email was changed in the last hour, so nobody can change an address and take the account in one go; one link a minute per person (429); an inactive person is refused; every use is written to the audit log by name only (`STAFF_PASSWORD_RESET_SENT`).
- Viewing and changing email and phone already existed in the staff edit form and is unchanged.

## Self-review (review gates: permissions, clinical data)

| Attack                                                                 | Result                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Admin resets a Super Admin                                             | 404, nothing sent (tested)                                      |
| Anyone resets themselves                                               | 409 SELF (tested)                                               |
| Reset for a person of another hospital, an unknown id, an inactive one | 404 / 404 / 409 (tested)                                        |
| Change an email, then reset at once                                    | 409 EMAIL_JUST_CHANGED, nothing sent (tested)                   |
| Two resets in a minute                                                 | 429 (tested)                                                    |
| Vitals changed after the consultation is completed, by nurse or doctor | 409, the saved value is unchanged (tested); reading still works |
| Print-only person reads a draft note                                   | 409 VISIT_NOT_COMPLETED (tested)                                |
| Print-only person opens the notes screen, the vitals screen or writes  | 403 on all of them (tested)                                     |
| Print-only person on another hospital's or an unknown visit            | 404 (tested)                                                    |
| Person without the permission calls print-data                         | 403 (tested)                                                    |
| Design view for a design not assigned to the hospital                  | 404 (the database shows only assigned designs)                  |

**Verdict: safe to approve.** The one decision to confirm: a print-only person can read the note and vitals of a completed visit through `print-data` (that is exactly what the printouts hold), and each read is audited.

## Not done or open

- Hospitals already set up need the new permission on their Receptionist and Nurse roles (the Roles screen, or the one command below), and the new sample designs (choose them again in Print designs).
- "Billed by" is a value the designs can use; hospital designs made earlier do not show it until the design is chosen again.
- The dev database needs `npm run dev:reset` (or the two small commands already run in this session) to show the new designs.

## Round 2 (Rakshith's review of Part 1)

- **Age and date of birth.** Registration shows ONE control: two buttons **Date of birth** (default, first) and **Age**, and one box. The sentences about estimating and "not sure of the date of birth" are gone. The date of birth opens the calendar properly (month and year lists, fixed width). Assumption: both kinds of entry stay (a baby or an exact date), but Date of birth is the default (Rakshith, 28 Nov). The calendar opens in a fixed layer (`calendar-popover-fixed`), placed against the window, so no card edge cuts it off.
- **Administration.** Staff edit and Add open in a pop-up window (like Roles). The action buttons sit in one row.
- **Leave requests number.** `GET /opd/leave-requests/pending-count` (needs `opd.doctors.write`); the Administration menu item and the Leave requests button show a number badge, refreshed every 20 seconds like the refund requests, so an Admin sees at once when a doctor asks for leave.
- **Graphs.** Labels are the day number ("14"), the full date is in the hover tip, so they fit under the bars and the line.
- **Back button on the prescription and report pages.** A person who came from the queue, or who may only print (no notes access), goes back to the OPD queue, not to the doctor's consultation view. The queue's print buttons add `?from=queue`. Nurse and reception verified in the tests of the print pages and by the queue links.
- **Note:** the receipt in the browser still showed the old "Payment" line because the old design copy is still chosen. `npm run dev:reset` (or choosing the design again in Settings, Print designs) shows the new one.
