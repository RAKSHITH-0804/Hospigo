# Manual regression checklist (Steps 8b and 8c)

Click through this once per release, role by role. Each line says what to click and what you should see. Use the demo accounts of `dev-accounts.md` (you log in yourself; passwords live in `.env`). Open the app at `http://127.0.0.1:3001`.

**Before you start:** migrate the dev database, run the seed, restart both servers (`docs/guides/dev-commands.md`). Check on a phone width, a tablet width and a wide screen: nothing may be cut off, hidden behind another block or need sideways scrolling, and every pop-up must fit the screen.

Tick a line only when you saw the result. If a line fails, write the line number and what you saw.

## A. Receptionist (`receptionist1@demo-north.example.test`, access code `demo-north-main`)

1. After login the menu shows Patients and OPD. There is **no Settings** item. My profile opens and shows your name, phone and email (no "My leave" block: you are not a doctor).
2. Patients: search by name, phone and UHID. Register a patient. The form shows the Other section; if the Admin added the reference fields (section E, line 11) you see Referred by, Category, Organisation and Staff number.
3. Open the patient, create a visit for a doctor. The doctor list shows only doctors who can be picked. A doctor on leave today is not offered (section E, line 1).
4. The consultation fee on the bill is the **new-visit fee** for a first visit. For a follow-up inside the free days the fee is free; after them it is the **follow-up fee**, or the **new-visit fee** when the doctor has no separate follow-up fee.
5. Take payment with **Cash**: the bill is paid, the receipt opens. The receipt shows the token (for example T7) and the bill number in the format set under Bill numbers.
6. Take payment with a mode that needs a **reference** (UPI or the Postman test mode): without a reference you get a calm message and nothing is paid; with a reference it is paid. A split payment (part Cash, part UPI) works the same way.
7. Print the registration slip, the receipt and the prescription. With a branch template or print values set (section E, lines 13 to 17) the printout uses the template of this branch and shows the values.
8. Cancel a visit that is still **waiting** (from the patient's Visits tab or from the OPD queue). **Cancel visit** opens a pop-up and creates a refund request; the visit stays waiting until an Admin who did not ask approves it. After approval the visit leaves the queue and the visit list and header show the token as **"T7 cancelled"**. Create the next visit: its token is the next number, never the cancelled one.
9. OPD, Queue: the **Doctor** drop-down lists only doctors that have visits in the queue; choosing one shows only their visits; All doctors shows all again. Waiting rows show **Cancel visit** when you may cancel; a visit with an approved cancellation is not in the queue.
10. OPD, Tests to bill and Refund requests open (if you have the permission); Collection report shows the day's money with refunds on their own.
11. Open Settings by typing `/app/settings` in the address bar: you are refused or sent back, never shown an Admin screen. Try `/app/settings/payment-modes`: refused.

## B. Nurse (`nurse1@demo-north.example.test`)

1. OPD, Queue shows the branch's waiting visits and the Doctor filter works as in A9.
2. Open a visit and record vitals: Pulse, Blood pressure, Temperature and so on, in the order set under Vitals fields.
3. Type a pulse outside the usual range (for example 200): a warning "Outside the usual range. Usual range: ..." appears **while typing**; you can still press Save. A field without a range never warns.
4. A vitals field the Admin deactivated is not shown. A text field (remarks) takes text and never warns.
5. No Settings item, no prices, no billing buttons.

## C. Doctor (`doctor2@demo-north.example.test`)

1. The queue shows **only your own** patients (no Doctor filter choice of other doctors).
2. Start a consultation, write the note and the prescription, complete it. Print the prescription: your name, qualifications, registration number and signature show; print values show if used in the template.
3. **My profile**: edit printed name, qualifications, speciality and registration number, upload and remove a signature. Saved messages appear and fade.
4. **My leave** (below the profile): choose a first and a last day (both from tomorrow on) and press **Ask for leave**. A row appears with **Waiting for an Admin** and a Cancel request button.
5. Ask again for the same or an overlapping day: a calm message says it overlaps. Ask for more than five at once: the sixth is refused with a calm message.
6. Press **Cancel request** on a waiting one: it shows **Cancelled** and the button goes.
7. After an Admin approves (section E): the row shows **Approved**, and there is **no** Cancel button (an approved leave is removed by an Admin in Availability). After an Admin rejects: **Not approved**.
8. You cannot open any Settings page.

## D. Branch Admin (`branchadmin@demo-north.example.test`, access code `demo-north-main`)

1. The menu shows Settings with the groups Hospital, People, Patients, OPD, Billing. **Bill numbers** is not listed (money numbering is hospital-wide). Print values and Printing are listed.
2. **Settings, Doctors**: you see only doctors of your own branch. Press **Edit** on a doctor: a pop-up opens (printed name, qualifications, speciality, registration number, department, signature). **Fees** opens Prices for that doctor. **Availability** opens a pop-up (switch, weekly times, leave).
3. **Leave requests (N)**: the number is the waiting requests of your branch's doctors. Open it: a table with Approve and Reject. Approve one: "Leave approved", the list refreshes, the number goes down. A request of a doctor of another branch is never shown.
4. **Settings, Printing**: you can only save **for this branch** (a note says so). Save a changed receipt design: "Saved". The line above says "This branch uses its own template". Press **Remove the template of this branch** and confirm: the hospital template (or the built-in default) is used again.
5. **Settings, Print values**: Add a value for this branch (code, name, text). Hospital-wide values are shown but have no Edit or Deactivate for you.
6. **Settings, Staff and Roles**: add and edit staff and roles in pop-ups; Activate and Deactivate work. You cannot create a role (SuperAdmin only).
7. Prices, Payment modes, Vitals fields, Upload lists: open each; the lists show; Add, Edit and Activate or Deactivate work in pop-ups where you hold the permission, and a refused action shows a calm sentence.

## E. SuperAdmin (`superadmin@demo-north.example.test`)

**Doctors and leave**

1. Settings, Doctors: all doctors of the hospital. **Leave requests (N)**: approve a request. Then Availability of that doctor: the leave is listed. At reception that doctor cannot be picked on those days but can be on other days.
2. Reject a request: nothing else changes. Press Approve on a request that overlaps leave you added by hand: a calm message, the request stays waiting, you can reject it.
3. Open the same request in two browser tabs and decide it in both: the second says it was already decided and the list refreshes.
4. Remove an approved leave in Availability: the doctor can be picked again.

**Prices (fee structure)**

5. Settings, Prices, Doctor fees: a doctor with no separate follow-up fee shows "same as new visit". Press **Set separate follow-up fee**, type an amount, save: it now has its own price and a note says it no longer follows the new-visit fee. Change the new-visit fee: the separate follow-up fee does not change. Bills already made never change.
6. Settings, Upload lists: upload the doctor fees Excel. New visit is required, follow-up may be empty (empty means the follow-up uses the new-visit fee). A row without a new-visit fee is refused with a clear message.

**Payment modes**

7. Settings, Billing, Payment modes: **Add payment mode** (pop-up) with a code (capitals), a name and "A reference must be typed". It appears in the list and at the reception payment screen. **Edit** renames it and changes the reference flag (the code is fixed). **Deactivate**: it disappears from payment. **Activate** brings it back. Cash cannot be deactivated. The last active mode cannot be deactivated.

**Vitals fields**

8. Settings, OPD, Vitals fields: **Add vitals field** (code, name, unit, Number or Text, usual range). The arrows change the order the nurse sees. Edit changes the name, unit and range (not the code or type). Deactivate hides it from nurses; Activate shows it again.

**Bill numbers**

9. Settings, Billing, Bill numbers: a card for Bill, Receipt and Refund numbers with the next number. **Change format** (pop-up): change the start text, year style, separator and digits; the preview changes while you type; save; the **next** bill gets the new look, old bills keep theirs.
10. Once a number exists the count rule and the financial year start are locked, with a note. **Set start number** can only raise the count (a lower number is refused with a clear message, the same number does nothing). It asks for a reason.

**Patients**

11. Settings, Patients, Registration fields: press **Add ready-made fields**. Referred by, Category, Organisation and Staff number appear in the Other section, on the form. Press it again: nothing is added twice. A field you made earlier with the same name is left exactly as it was.
12. Register a patient: the new fields show on the form and save. Open the patient: the values show.

**Printing and print values**

13. Settings, Printing: choose a document. A **Save for** choice offers **The whole hospital** and **This branch only**. Save a design for the whole hospital: every branch uses it. Sign in at the East branch (`demo-north-east`) and check the receipt uses the hospital design; save a different one for East only: East uses its own, Main still the hospital one.
14. **Remove** acts on the chosen place: removing East's falls back to the hospital design; removing the hospital design falls back to the built-in default.
15. Settings, Print values: **Add print value** for the whole hospital (for example code `helpline`, name Helpline, text 1800 000 000). Type `<b>` in the text: refused with a calm message. Add the same code again: "already exists". Deactivate it, Activate it.
16. In Printing, select a text box and use **Insert value**: your value is listed under its name. Place it on the receipt, save, print a receipt: the text shows. Deactivate the value: the receipt prints without it and nothing breaks.
17. Add a value with the same code for East only: East prints the East text, Main the hospital text. Deactivate East's: East prints nothing for it, Main still prints the hospital text.

**Other**

18. Settings, Staff, Roles, Logo: open each, add or edit in a pop-up, saved messages appear.
19. Reports: the collection report shows the day's totals; refund requests can be approved by an Admin who did not ask for them.
20. Sign out and sign in as an Admin of the other hospital (`superadmin@demo-south.example.test`): none of the values, templates, leave requests or payment modes of Demo North show.

## F. After the checklist

Write down every line that failed, with the role, the page and what you saw. Do not fix by hand in the database. Open a new step in the tracker for each real problem.
