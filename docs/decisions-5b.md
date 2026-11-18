# Decisions: Step 5b (nurse and doctor screens)

PR title: **Step 5b: OPD queue, vitals and consultation screens for nurse and doctor**. Branch `feature/phase2-step-5b-nurse-doctor-web`. Web only: no migration, no new permission, no API change (the 5a API from PR #47 is used as it is).

## What was built

- **`/app/opd` (the queue)** replaces the old sample-data page. A doctor sees their own waiting patients; a nurse sees the whole branch (with a doctor column). It lists EVERY open visit, not only today's: a patient still waiting after midnight stays on the list with a red "From 18 Nov 2026" tag (found when a manual test crossed midnight and the whole list went empty). Token, name, UHID, gender, age, status and a "vitals recorded" tag. Refreshes by itself every `WEB_OPD_QUEUE_REFRESH_SECONDS` (default 20, 0 = off, skipped while the tab is hidden) and on a Refresh button; a failed refresh keeps the list on screen and says so. Staff without `opd.queue.read` (reception) see a pointer to Patients. The old `OpdQueueScreen` component and its test were removed on purpose (it showed invented numbers).
- **`/app/opd/visits/[id]/vitals`**: fields come from `GET /opd/vitals-fields` (nothing hardcoded). A blank box is skipped, a value equal to the current reading is skipped, changing an existing reading asks for a reason (the old reading stays in the history, shown under "History"). Nothing is sent while a typed value is invalid. All fields sit on ONE screen in a responsive grid (no long scrolling). Values outside the warning range are flagged. Without `opd.vitals.write` the page is read-only.
- **`/app/opd/visits/[id]/consult`**: patient header (name, UHID, gender, age, token, doctor, status), current vitals, "Start consultation" while waiting, note (complaints, diagnosis, advice, follow-up date), prescription rows (search the medicines list or type a name, flagged "unlisted"; dose, frequency, duration, instructions), "Save draft" and "Complete consultation". After completing the page is read-only and shows the addenda (who, when, why) with a form to add one. A "Previous visits" list streams in after the page (earlier COMPLETED visits the caller may see; opening one shows its read-only note, and that read is audited by the API).
- **Next route handlers** under `/api/staff/opd/...` for the 11 clinical routes (JSON 401/403, never a redirect; same-origin, JSON-only, object-only bodies; writes go through the branch guard). The proxy also passes `fieldCode` and `index` of a refusal on.

## Decisions made while building (not in the plan)

- **Auto-save (asked for by Rakshith):** the draft note and the prescription are saved `WEB_OPD_AUTOSAVE_SECONDS` (default 5) after the last keystroke, one save at a time, only what changed, only while the consultation is running. A status line shows "Saving", "Saved at hh:mm", "Not saved yet" or "Not saved. Trying again." (three automatic retries). The browser warns when the tab is closed with unsaved typing. Each auto-save is one `OPD_NOTE_SAVE` audit row (field names only).
- **Complete = save, then complete.** It waits for a running save, saves anything unsaved, and stops if that fails. Unfinished medicine rows block it with a message (they are never dropped silently); a row with nothing typed is ignored. Complaints or diagnosis must hold text (the API checks too).
- **Unfinished medicine rows are not saved** until finished (the API would refuse them); they stay on screen with a "not saved yet" count.
- **No patient phone number** in the doctor header (the API does not send it and a doctor does not need it).
- **Doctor vs nurse in the UI:** "Open" (consultation) shows for staff with `opd.notes.write`; "Vitals" for staff with `opd.vitals.write`. A nurse can still read a note (read-only, audited) from Previous visits or by link. The API stays the only authority; the screens only hide what would be refused.
- **Double-click safety** uses a ref guard (not state) on Start, Complete, vitals save and addendum, so two clicks in the same moment send one request (a test found the state-based guard was too weak).
- New copy lives in `staffCopy.opd.clinical`; the API error codes of 5a have messages in `staffCopy.opd.errors`. New UI-kit piece: `TextareaField`.

## Click path (Rakshith proves it)

Start the API and web. Log in yourself (access code `demo-north-main`, password from `.env`): receptionist1 creates two visits for doctor2 (Patients, a patient, New visit, doctor, Take cash). Then:

1. **nurse1** opens OPD queue: both patients, doctor column. Click **Vitals** on the first: pulse 72, SpO2 98, Save. Back in the queue the row says Recorded. Open Vitals again, type pulse 80: a reason box appears; Save without a reason is refused; with a reason it saves and History shows both versions.
2. **doctor2** opens OPD queue: only their two patients, in payment order. **Open** the first. See the vitals. Click **Start consultation**. Type complaints, wait 5 seconds: "Saved at ..." appears. Add a medicine (search "Mock", pick one) and an unlisted one (Type the name). Click **Complete consultation**: the page becomes read-only and the patient leaves the queue.
3. Reload the completed page: add an **addendum** (text and reason): it appears with your name.
4. **receptionist1**: the patient's Visits tab shows the visit COMPLETED.

## Not in this PR

Cancelling a visit, investigations and refunds (6a), cross-branch note history, printing a prescription, the patient phone number.

## Changes after the first manual test (19 Nov)

- **Queue after midnight (bug):** the queue API listed only today's visits, so at 12:00 am every patient paid the day before vanished. The API now lists every open visit (oldest first, `date` = today, each item has its `visitDate`); the screen tags older ones. Tests: a visit paid two days ago stays and is listed before today's.
- **Vitals on one page:** the fields are laid out in a responsive grid (about four per row on a wide screen); the box labels are hidden (the card title names the field; screen readers still get "Pulse: New value").
- **Note boxes grow as you type:** each starts as one small line and grows with the text up to a limit, then scrolls (`TextareaField`).
- **Prescription form:** the doctor starts with one empty line ready for typing. Each medicine is ONE LINE (medicine search or typed name, dose, frequency, duration, instructions, remove). "Add medicine" is under the lines; if an empty line is already waiting it is reused instead of adding another; Enter in the last finished line starts the next one. A small link switches a line between "Use the medicine list" and "Not in the list? Type the name". The read-only view names every part ("Dose 1 tablet · Frequency twice a day · Duration 5 days").
- **New calendar for the follow-up date** (`DatePicker`): month grid with previous/next, today marked, the chosen day highlighted, days before the visit day greyed out, quick picks (Tomorrow, In 3, 7, 14, 30 days; `followUpQuickDays`), Clear and Close; Escape or a click outside closes it. The week starts on Monday (`WEB_CALENDAR_WEEK_START`, 0 to 6).

## Changes after the second manual test (19 Nov)

- **A medicine that is not in the list (bug):** a doctor typed "Tab 1" in the search box, filled dose, frequency and duration, and the red "unfinished" line never went away, because the medicine was never picked. Now: (1) text typed in the search box can be used as typed with one click ("Use “Tab 1” as typed (unlisted)"); (2) switching between "Use the medicine list" and "Not in the list? Type the name" keeps the typed text; (3) the red line says exactly what is still needed ("Still needed: dose, duration."), and text typed only in the search box counts as an unfinished line (it blocks Complete, it is never dropped silently).
- **Who has been seen today:** `GET /opd/queue` now also returns the visits completed today. The queue page has three filters with counts: **Waiting** (waiting + in consultation), **Completed today** and **All**. Doctors and nurses start on Waiting; read-only staff (reception) start on All. Each row shows the status, the vitals state (Recorded / Pending), the doctor (branch view) and, for completed visits, the time. Completed rows have **View** (note, read only, audited) and **Vitals** for those who may.
- **Reception sees the queue (read only):** the dev Receptionist role gets `opd.queue.read`. They see tokens, names, doctor, status and vitals state only: no clinical text, no money, no buttons; the note and vitals routes still answer 403 for them. (Business decision from Rakshith; to be confirmed with the manager.)
- **Consultation on one screen:** complaints and diagnosis sit side by side, advice and the follow-up date below them (one column on a narrow screen).

## Click path update (replaces the earlier steps where they differ)

1. **Reception** (`receptionist1`, re-run the dev seed first): OPD queue now opens with the filter **All**: every patient of the branch with doctor, status (Waiting / In consultation / Completed) and vitals (Recorded / Pending), and no buttons.
2. **Nurse**: queue starts on Waiting. After a doctor completes a patient, open **Completed today**: the patient is there with the time and a **View** button.
3. **Doctor**: same for their own patients.
4. **Prescription**: search a name that is not in the list (for example "Tab 1"): "No medicine found." appears with a link "Use “Tab 1” as typed (unlisted)". Click it, fill dose, frequency and duration: the red line goes away and the line saves.
