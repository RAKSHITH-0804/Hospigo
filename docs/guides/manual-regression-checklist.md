# Manual regression checklist (all of Phase 2: Steps 3 to 9)

Click through this once per release, role by role. Each line says what to click and what you should see. Use the demo accounts of `dev-accounts.md` (you log in yourself; passwords live in `.env`). Open the app at `http://127.0.0.1:3001`.

**Before you start:** migrate the dev database, run the seed, restart both servers (`docs/guides/dev-commands.md`). Step 9 added three migrations (the app login loses DELETE on `users` and structure tables, an index on bills, the branch column on doctor fees). Run the Postman collections first (`postman/collections/`, import one, press Run collection; one per step, 3d to 8c; the environment file with the demo passwords stays on your PC).

Check on a phone width, a tablet width and a wide screen: nothing may be cut off, hidden behind another block or need sideways scrolling, and every pop-up must fit the screen.

Tick a line only when you saw the result. If a line fails, write the line number and what you saw. Results of the last run: **pending Rakshith**.

## G. Everyone: login, My profile, sign out

1. Login page: type the access code, e-mail and password of a demo account: you reach the dashboard of that role. A wrong password gives one calm message that does not say which part was wrong. After several wrong tries in a row you are slowed down (calm message), not shown an error page.
2. **Forgot password:** ask for a reset: the answer is the same whether the e-mail exists or not. Use the link (dev mail) and set a new password; the old one stops working.
3. **My profile** (everyone): name, phone, e-mail show. Change e-mail or password: it asks for a code first; a wrong code is refused calmly; the right code saves.
4. Sign out, then press the browser Back button: you cannot see the old page (you are sent to login).
5. Open the app in two tabs, switch branch (SuperAdmin) in one: the other tab says the branch changed and reloads; it never shows the old branch's data under the new branch's name.
6. A staff member you **switch off** (Settings, Staff): their next page or action is refused at once. _Known limit: a token they already hold keeps working on routes that need no permission for up to 15 minutes._
7. `/book/<access code>` says "Coming soon" (online booking is not in release 1). The patient portal login page opens; nothing there shows hospital data without a code.

## A. Receptionist (`receptionist1@demo-north.example.test`, access code `demo-north-main`)

1. After login the menu shows Patients and OPD. There is **no Settings** item. My profile opens and shows your name, phone and email (no "My leave" block: you are not a doctor).
2. Patients: search by name, phone and UHID. Register a patient. The form shows the Other section; if the Admin added the reference fields (section E, line 11) you see Referred by, Category, Organisation and Staff number.
3. Open the patient, create a visit for a doctor. The doctor list shows only doctors who can be picked. A doctor on leave today is not offered (section E, line 1).
4. The consultation fee on the bill is the **new-visit fee** for a first visit. For a follow-up inside the free days the fee is free; after them it is the **follow-up fee**, or the **new-visit fee** when the doctor has no separate follow-up fee. **With a fee set for this branch (section E, line 21) the doctor list and the bill show the branch fee; in a branch without one, the hospital-wide fee.**
5. Take payment with **Cash**: the bill is paid, the receipt opens. The receipt shows the token (for example T7) and the bill number in the format set under Bill numbers.
6. Take payment with a mode that needs a **reference** (UPI or the Postman test mode): without a reference you get a calm message and nothing is paid; with a reference it is paid. A split payment (part Cash, part UPI) works the same way. The Remove button of a payment line sits under its row and is aligned.
7. Print the registration slip, the receipt and the prescription. With a branch template or print values set (section E, lines 13 to 17) the printout uses the template of this branch and shows the values.
8. **Cancel and refund.** Cancel a visit that is still **waiting**, from the patient's Visits tab: a pop-up opens (the table does not move) with the amount to return (the whole fee unless you change it) and a reason; **Send request**. The visit stays in the queue and shows **Waiting** until an Admin **who did not ask for it** approves the refund; then the row leaves the queue and the patient's visit list shows the token as **"T7 cancelled"**. Create the next visit: its token is the next number, never the cancelled one. Do the same from the **OPD queue** page (the Cancel visit button on a waiting row opens the same pop-up). An Admin cannot approve their own request.
9. OPD, Queue: the **Doctor** drop-down lists only doctors that have visits in the queue; choosing one shows only their visits; All doctors shows all again. A cancelled visit is not in the queue.
10. **Tests to bill:** the tests a doctor ordered are listed; bill them with Cash (and with a reference mode): a test bill and receipt are made, the list updates, the bill number follows the Bill numbers format. A test can be refunded like a visit (a request first; money returns only after approval).
11. **Refund requests** page: pending, approved and rejected requests with the amount and reason; you see only your branch's requests. A rejected request leaves the visit and money unchanged.
12. **Collection report** (if you hold the permission): the day's money by payment mode, with refunds shown on their own line, for the chosen day and branch; filters work; **Excel**, **CSV** and **Print** produce the same totals as the screen.
13. **Patient numbers (UHID):** a new patient gets the next number in the set format (prefix, year, digits); two patients never share one; a number is never reused after a patient is deactivated. Registering the same person twice (same name and date of birth) shows a duplicate warning and asks you to confirm.
14. Open Settings by typing `/app/settings` in the address bar: you are refused or sent back, never shown an Admin screen. Try `/app/settings/payment-modes` and `/app/settings/prices`: refused.

## B. Nurse (`nurse1@demo-north.example.test`)

1. OPD, Queue shows the branch's waiting visits and the Doctor filter works as in A9.
2. Open a visit and record vitals: Pulse, Blood pressure, Temperature and so on, in the order set under Vitals fields.
3. Type a pulse outside the usual range (for example 200): a warning "Outside the usual range. Usual range: ..." appears **while typing**; you can still press Save. A field without a range never warns.
4. A vitals field the Admin deactivated is not shown. A text field (remarks) takes text and never warns.
5. No Settings item, no prices, no billing buttons. You see only your own branch's visits.

## C. Doctor (`doctor2@demo-north.example.test`)

1. The queue shows **only your own** patients (no Doctor filter choice of other doctors).
2. Start a consultation, write the note and the prescription, complete it. The consultation page uses card sections that fit one wide screen without scrolling for a normal visit. **Order tests** in the consultation: they appear at reception under Tests to bill. Print the prescription: your name, qualifications, registration number and signature show; print values show if used in the template.
3. A **completed** note cannot be edited; the page says so. Add an **addendum** (a correction with a reason): it is listed, the original text is unchanged. Previous visits of the patient are listed.
4. **My profile**: edit printed name, qualifications, speciality and registration number, upload and remove a signature. Saved messages appear and fade.
5. **My leave** (below the profile): choose a first and a last day (both from tomorrow on) and press **Ask for leave**. A row appears with **Waiting for an Admin** and a Cancel request button.
6. Ask again for the same or an overlapping day: a calm message says it overlaps. Ask for more than five at once: the sixth is refused with a calm message.
7. Press **Cancel request** on a waiting one: it shows **Cancelled** and the button goes.
8. After an Admin approves (section E): the row shows **Approved**, and there is **no** Cancel button (an approved leave is removed by an Admin in Availability). After an Admin rejects: **Not approved**.
9. You cannot open any Settings page.

## D. Branch Admin (`branchadmin@demo-north.example.test`, access code `demo-north-main`)

1. The menu shows Settings with the groups Hospital, People, Patients, OPD, Billing. **Bill numbers is not listed** (the money numbering is hospital-wide). Print values and Printing are listed.
2. **Settings, Doctors**: you see only doctors of your own branch. Press **Edit** on a doctor: a pop-up opens (printed name, qualifications, speciality, registration number, department, signature). **Fees** opens Prices for that doctor. **Availability** opens a pop-up (switch, weekly times, leave).
3. **Leave requests (N)**: the number is the waiting requests of your branch's doctors. Open it: a table with Approve and Reject. Approve one: "Leave approved", the list refreshes, the number goes down. A request of a doctor of another branch is never shown.
4. **Settings, Printing**: you can only save **for this branch** (a note says so). Save a changed receipt design: "Saved". The line above says "This branch uses its own template". Press **Remove the template of this branch** and confirm: the hospital template (or the built-in default) is used again.
5. **Settings, Print values**: Add a value for this branch (code, name, text). Hospital-wide values are shown but have no Edit or Deactivate for you.
6. **Settings, Staff and Roles**: add and edit staff in pop-ups; Activate and Deactivate work. You cannot create or edit a role (on the manager list for a later phase).
7. Payment modes, Vitals fields, Upload lists: open each; the lists show; Add, Edit and Activate or Deactivate work in pop-ups where you hold the permission, and a refused action shows a calm sentence.
8. **Per-branch doctor fees:** Settings, Prices: the note says the doctor fees shown are for your branch; each doctor fee shows **This branch** or **Hospital-wide**. On a hospital-wide fee press **Set fee for this branch**, type an amount, save: it now shows **This branch** with the new amount, and a visit at reception in your branch bills it. The history of that fee lists only your branch's versions. You get **no** "Applies to" choice: the hospital-wide fee is not yours to change. Tests and the registration fee show the same in every branch.
9. **Upload lists, Doctor fees:** the sample file has a **Branch code** column. A row with your branch's code is saved for your branch; a blank code (hospital-wide) or another branch's code is an exception with a clear reason; nothing else in the file is lost.
10. Try a URL of another branch's data (for example another branch's Doctors or refund requests): empty or refused, never shown.

## E. SuperAdmin (`superadmin@demo-north.example.test`)

**Doctors and leave**

1. Settings, Doctors: all doctors of the hospital (with the branch switcher on a branch, the doctors of that branch). **Leave requests (N)**: approve a request. Then Availability of that doctor: the leave is listed. At reception that doctor cannot be picked on those days but can be on other days.
2. Reject a request: nothing else changes. Press Approve on a request that overlaps leave you added by hand: a calm message, the request stays waiting, you can reject it.
3. Open the same request in two browser tabs and decide it in both: the second says it was already decided and the list refreshes.
4. Remove an approved leave in Availability: the doctor can be picked again.
5. **A doctor changes branch** (Staff, change the doctor's branch from Main to East) while a leave request is waiting: the Branch Admin of Main no longer sees that request; the Branch Admin of East and you do, and can decide it. Approving it blocks the doctor on those days in every branch.

**Prices (fee structure)**

6. Settings, Prices, Doctor fees: a doctor with no separate follow-up fee shows "same as new visit". Press **Set separate follow-up fee**, type an amount, save: it now has its own price and a note says it no longer follows the new-visit fee. Change the new-visit fee: the separate follow-up fee does not change. Bills already made never change.
7. Settings, Upload lists: upload the doctor fees Excel. New visit is required, follow-up may be empty (empty means the follow-up uses the new-visit fee). A row without a new-visit fee is refused with a clear message. A cancelled or failed upload leaves no file behind (nothing to check on screen; a posted upload cannot be undone).

**Payment modes**

8. Settings, Billing, Payment modes: **Add payment mode** (pop-up) with a code (capitals), a name and "A reference must be typed". It appears in the list and at the reception payment screen. **Edit** renames it and changes the reference flag (the code is fixed). **Deactivate**: it disappears from payment. **Activate** brings it back. Cash cannot be deactivated. The last active mode cannot be deactivated.

**Vitals fields**

9. Settings, OPD, Vitals fields: **Add vitals field** (code, name, unit, Number or Text, usual range). The arrows change the order the nurse sees. Edit changes the name, unit and range (not the code or type). Deactivate hides it from nurses; Activate shows it again. (Deactivate the leftover test field "Postman reading".)

**Bill numbers**

10. Settings, Billing, Bill numbers: a card for Bill, Receipt and Refund numbers with the next number. **Change format** (pop-up): change the start text, year style, separator and digits; the preview changes while you type; save; the **next** bill gets the new look, old bills keep theirs.
11. Once a number exists the count rule and the financial year start are locked, with a note. **Set start number** can only raise the count (a lower number is refused with a clear message, the same number does nothing). It asks for a reason.

**Patients**

12. Settings, Patients, Registration fields: press **Add ready-made fields**. Referred by, Category, Organisation and Staff number appear in the Other section, on the form. Press it again: nothing is added twice. A field you made earlier with the same name is left exactly as it was. Register a patient: the new fields show on the form and save. Open the patient: the values show.
13. Settings, Patients, Patient number format: change the format; the next new patient gets it, old numbers keep theirs; the counter never goes back.

**Printing and print values** (do these at the end of Phase 2: Rakshith)

14. Settings, Printing: choose a document. A **Save for** choice offers **The whole hospital** and **This branch only**. Save a design for the whole hospital: every branch uses it. Sign in at the East branch (`demo-north-east`) and check the receipt uses the hospital design; save a different one for East only: East uses its own, Main still the hospital one.
15. **Remove** acts on the chosen place: removing East's falls back to the hospital design; removing the hospital design falls back to the built-in default.
16. Settings, Print values: **Add print value** for the whole hospital (for example code `helpline`, name Helpline, text 1800 000 000). Type `<b>` in the text: refused with a calm message. Add the same code again: "already exists". Deactivate it, Activate it.
17. In Printing, select a text box and use **Insert value**: your value is listed under its name. Place it on the receipt, save, print a receipt: the text shows. Deactivate the value: the receipt prints without it and nothing breaks.
18. Add a value with the same code for East only: East prints the East text, Main the hospital text. Deactivate East's: East prints nothing for it, Main still prints the hospital text.
19. Registration slip: print it, check the **Relative** box, the logo and signature pictures. Print the receipt on **pre-printed stationery** mode (only the dot-matrix hardware test is a go-live blocker).

**Branch switching**

20. The top bar shows a branch switcher. Switch to East Wing: the page reloads for East; **Settings, Doctors** lists the doctors who work in East (a doctor of Main only is not there); the OPD queue shows East's visits; **Settings, Prices** shows the note "Doctor fees shown for this branch: East Wing" and East's doctors. Switch back: Main's data returns. Nothing from the other branch stays on screen.

**Per-branch doctor fees (Step 9)**

21. Settings, Prices, with **East Wing** selected, a doctor who works in East and Main: press **Set fee for this branch**; the pop-up has an **Applies to** choice (This branch only / Whole hospital). Choose **This branch only**, type 700, save: the row shows 700 with **This branch**. At reception in East that doctor bills 700; at reception in Main the old hospital-wide fee. The follow-up row (if it has its own hospital-wide fee) is unchanged.
22. Choose **Whole hospital** and change the hospital-wide fee: East still bills its own branch fee, Main bills the new hospital-wide fee. Choose a date in the future: nothing changes until that day; bills already made never change.
23. History of a doctor fee shows the versions of the scope shown (branch versions with **This branch**, hospital-wide versions otherwise); old versions stay listed, nothing is deleted.
24. Upload lists, Doctor fees: add a **Branch code** (for example EAST) to a row: saved for East only; blank is hospital-wide; an unknown code or a doctor who does not work in that branch is an exception with a reason.

**Other**

25. Settings, Staff, Roles, Logo: open each, add or edit in a pop-up, saved messages appear. Create a role with chosen permissions and give it to a person; deactivate it.
26. Reports: the collection report shows the day's totals for any branch you choose; refund requests can be approved by an Admin who did not ask for them. Approve a request someone else asked: the money returns, the visit is cancelled, the token shows cancelled.
27. Sign out and sign in as an Admin of the other hospital (`superadmin@demo-south.example.test`): none of the values, templates, leave requests, payment modes, fees or patients of Demo North show.

## F. After the checklist

Write down every line that failed, with the role, the page and what you saw. Do not fix by hand in the database. Open a new step in the tracker for each real problem.
