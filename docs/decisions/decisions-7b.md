# Decisions, Step 7b (settings screens): API and web, one step

Branch: `feature/phase2-step-7-reports-print-api` (7b is committed on top of Step 7; one pull request for both). Built 21 Nov 2026. Final checks: API 714 tests, web 1275 tests, lint, format, TypeScript and the production build green.

## Answers from Rakshith (planning, 21 Nov)

- Who may change these settings: **SuperAdmin and Branch Admin both**. All three screens use the existing permissions (`hospital.settings.read` to see, `hospital.settings.write` to change; the OPD rules use `opd.settings.write` with the OPD module, like the print templates). Both system roles hold them already; no migration, no new permission.
- One step, one PR for all of 7b (not 7b-1, 7b-2, 7b-3).

## What was built

API (new module `hospital-settings`, routes under `/settings`):

| Route                                       | Permission                 | What it does                                                                         |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `GET /settings/opd-rules`                   | `hospital.settings.read`   | Free follow-up days, free repeat-visit hours, `persisted`, limits                    |
| `PUT /settings/opd-rules`                   | `opd.settings.write` (OPD) | One or both numbers (whole numbers in range); audit `OPD_RULES_CHANGE` (field names) |
| `GET /settings/patient-fields`              | `hospital.settings.read`   | Standard fields with switches, the hospital's own fields with choices, limits        |
| `PUT /settings/patient-fields/builtin/:key` | `hospital.settings.write`  | Show/hide and required/optional of a standard field                                  |
| `POST /settings/patient-fields/custom`      | `hospital.settings.write`  | Add an own field: TEXT, NUMBER, DATE or DROPDOWN (with choices), section, required   |
| `PATCH /settings/patient-fields/custom/:id` | `hospital.settings.write`  | Rename, move to a section, show/hide, required/optional                              |
| `PUT .../custom/:id/options`                | `hospital.settings.write`  | Replace the choices of a dropdown                                                    |
| `GET /settings/uhid-format`                 | `hospital.settings.read`   | Format in use, sample, next number, the active branch code, limits                   |
| `POST /settings/uhid-format`                | `hospital.settings.write`  | Start a new patient number format from now on; audit `UHID_FORMAT_CHANGE`            |

Web: a new section **OPD rules** (`/app/settings/opd-rules`), and the **Patient registration** section now holds three blocks: Registration fields, Patient number format, Next UHID number (the existing card). Six Next route handlers under `/api/staff/settings/...` proxy the writes (same-origin check, JSON body, branch guard; the token never reaches the browser).

## Decisions made while building (not in the plan)

- **Nothing is ever deleted.** A custom field is switched off, not removed; a dropdown choice left out of a save is switched off, not removed. Answers patients already gave stay valid. The type and code of a field cannot change after it is added.
- **A field that is off is never required** (the API forces it).
- **Locked standard fields:** the catalog says which fields cannot be switched off (`canDisable`) or relaxed (`alwaysRequired`). Name is always on and required; phone cannot be switched off. The API answers `400 SETTINGS_INVALID` with reason `LOCKED`.
- **Field code** of an own field is made from its name (`cf_` plus letters and digits), made unique with `_2`, `_3`. Two administrators adding the same name at once: one wins, the other gets `DUPLICATE` (the database unique key is mapped, never a 500).
- **Limits (one place):** 30 own fields per hospital, name 60 characters, 50 choices per dropdown (`FIELD_SETTINGS_LIMITS`). UHID format: 12 parts, text up to 10 characters of letters, digits and `/ _ . -`, running number 1 to 12 digits, the longest possible number at most 30 characters (`UHID_FORMAT_LIMITS`). The screen reads the limits from the API; the web has no copy of them.
- **UHID format safety.** Old formats stay (history, immutable) and numbers already issued never change. A new format can count in another period than the old one (for example "never restart" to "restart every financial year"): then the new period's counter starts at the old counter (raise only, `GREATEST`, inside the same transaction), so the running number never goes back and a number is never issued twice. The audit records block TYPES and whether the counter was carried forward, never the text values. If two formats are saved in the same moment, the newer row (by time, then creation, then id) wins for every reader.
- **Saving a number format asks twice** on the screen ("use this format for new patients from now on?"), because it affects every new patient.
- **A Branch Admin of one branch changes the format for the whole hospital** (the format and the counter are hospital-wide). This follows Rakshith's answer; it is audited with the user. Revisit if a hospital objects.
- **OPD rules write only the two numbers.** Token prefix, time zone and tax are not on this screen.
- **Time zone** of the UHID format stays the one of the existing format (default Asia/Kolkata).
- `staffRoute` passes `code`, `field` and `reason` of a refusal to the browser, so the screen can say "Cannot save: text (part 2) is not valid." The wording is in one typed copy file.

## Tests

- API: `hospital-settings.endpoints.spec.ts` (30 tests): access on every route (401 without token or with a patient token, 403 for reader/reception/nobody on writes, OPD rules need `opd.settings.write`), tenant isolation (other hospital's field and option ids are 404 or refused, nothing leaks into the other hospital's form), every validation with its field and reason, audit by names only, counter carry-forward, concurrent create, and that the registration form follows the settings.
- Web: opd-rules-form, uhid-format-card, registration-fields, settings-lib (error wording, preview), settings routes (6 routes: origin, content type, junk bodies, encoding of path parameters, JSON 401), the settings page wiring.
- Postman: `postman/collections/hospigo-7b-settings.postman_collection.json` (45 requests). It restores the OPD rules and the number format, switches off the fields it adds, and registers one patient to prove the new format is used. Not run by the assistant (needs the dev passwords): Rakshith runs it.

## Not done (follow-ups)

- Reordering own fields and changing the label of a standard field: the order is by creation; standard labels are fixed.
- A history screen for number formats and field changes (the audit has them).
- Per-branch UHID formats (the format is hospital-wide by design).
- Tax and token prefix settings screens.
- The receipt header and footer screen: the print designer covers it; check for a real gap after the demo.
- Custom field rules beyond type (minimum, maximum, pattern).
- 8a is named differently in the tracker (NestJS 12 upgrade) and in the handoff (logo upload): Rakshith to say which.

## UI rework after the first look (21 Nov)

Rakshith found the screens long, wasteful of space and unclear. Changed (screens and wording only; the API and saved data are untouched):

- **Separate pages instead of one long page:** the left menu now has Registration fields, Patient numbers, OPD rules, Printing. The route `/app/settings/patient-registration` stays (shown as "Registration fields"); the number format and the next-number card moved to the new `/app/settings/patient-numbers`.
- **Wide layout:** these pages use the whole width. Two blocks sit side by side (`settings-columns`) and stack on narrow screens. Column and field widths are tokens in `globals.css`.
- **One table shape:** standard fields and own fields share one header row and the same four columns, so the checkboxes line up. Section and type are shown as small text under the field name, not as extra columns.
- **Clearer names:** "Show" is now **Ask on form** and "Required" is **Must be filled** (hover hints; a note under the table). A field that is not asked cannot be made compulsory and says why. Patient numbers: "Start again from 1", "Pieces of the number, left to right", "Number of digits", "Add a piece".
- **Add a field** opens from a button and closes after a successful add; Cancel closes it.
- **Moving and removing pieces** are small icon buttons with a name and a hover title.
- **"Saved." fades after 3 seconds** (`settingsScreenConfig.savedMessageMs`); an error stays until the next action. The line keeps its height, so nothing jumps.
- Not checked in a real browser by the assistant: the look at phone, tablet and wide widths.

## "About this page" help block (21 Nov)

Rakshith asked for help on the settings pages, so an administrator can understand a setting without contacting the company.

- One shared block (`settings-help.tsx`) on every settings page, put there by `SettingsShell`: what this is, how to set it (numbered steps), an example, good to know. It is **closed when the page opens** (only people with a doubt need it); a "Show help" button opens it and "Hide" closes it. Nothing is stored in the browser (Rakshith, 21 Nov: closed by default, opened by the user).
- The wording lives in `staffCopy.settings.help.pages`, keyed by the section id. A new settings page needs its entry there; a test fails if a section has no help, if the text is too long (about 30 seconds of reading), or if a button name used in the steps is not on the screen.
- Written by the assistant from what the screens do; Rakshith to read it during the click-test and report unclear or wrong wording.
