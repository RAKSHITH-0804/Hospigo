# Phase 2.1: Addendum 1 (26 Nov 2026, night)

Save as `docs/plans/phase-2-1-addendum-1.md`. It sits beside `docs/plans/phase-2-1-demo-changes.md` (the main plan). **Where this addendum and the main plan disagree, this addendum wins.** Claude Code must read both, then update `docs/decisions/decisions-2-1.md` from section 2 and section 6 of this file.

## 1. Principle behind every change

Hospigo is a multi-tenant SaaS built by Indigo, a software company. Hospitals are Indigo's CLIENTS. Indigo onboards each hospital from the Indigo login, assigns only the modules that hospital needs, and controls the whole software. Every change must be doable in ONE CLICK with NO code edit, so nothing is hardcoded anywhere: business values (default paper, label size, patient card on or off, templates, roles, permissions, modules, branch assignments, display rules) live in the database with a screen to change them. UI words stay in the single copy file (`staff-copy.ts`), always read through that layer so a later override layer can replace them.

## 2. Corrections to the main plan

1. **Prescription and Patient report are two completely separate documents and print types. Never mix them.**
   - **Patient report** = the patient's copy, exactly as today's full print (vitals, symptoms, diagnosis, medicines, tests, advice, follow-up, signature).
   - **Prescription** = the slim document that goes to the pharmacy: hospital and doctor header, the medicines the doctor entered, the doctor's signature. No vitals, no billing, no patient-report sections.
   - Each has its own print type, its own template list, its own default and its own purpose. No template is shared between them. Saved templates made for today's "prescription" move to PATIENT_REPORT; the slim PRESCRIPTION starts with its own default (old saved PRESCRIPTION templates must not render the slim document with empty vitals boxes: retire or deactivate them safely, nothing is deleted, say what you chose). Later the Pharmacy module reads the prescription DATA, not the printout.
2. **Two kinds of Indigo users.**
   - **Indigo Owner** (system role code `TENANT_ADMIN`): full control. Onboards hospitals, assigns modules, makes print templates and logos, loads data, and acts inside any hospital with full power. Patient data visible, every view logged.
   - **Indigo Employee** (new system role, code `INDIGO_EMPLOYEE`): narrower. Works only in hospitals the Owner assigned. Configuration and data loading (staff, roles, medicines, tests, prices, Excel uploads) for those hospitals. NO patient data, NO print templates or logos, NO creating hospitals, NO module changes, cannot create other Indigo users. An Employee MAY create staff accounts, including the hospital's SuperAdmin, for the hospitals assigned to him (decided 26 Nov 2026).
   - Only Owners create Employees (invite by email); the first Owner is created once through the seed.
3. **Print templates and logos: only the Indigo Owner** creates and changes them (2 to 3 templates per print type). SuperAdmin and Admin only CHOOSE among the templates provided to their hospital. Doctor signatures stay as built (the doctor, or an Admin in scope, uploads them).
4. **Staff creation, role creation, medicines, tests, prices and other master data:** both Indigo (Owner; Employee for assigned hospitals) and the hospital's SuperAdmin or Admin can do them. Roles are created by Indigo and SuperAdmin only. An Admin keeps staff and masters of his own branches.
5. **Terminology (label overrides per hospital) is controlled by Indigo only, never by hospital users.** DECIDED 26 Nov 2026: option A, a SHORT LIST of about 20 to 30 key terms (patient number label, symptoms or complaints, desk name, token, doctor, visit, bill, receipt and fee names), not every label; error messages, help texts and rarely used labels stay fixed for now, and every other text keeps its key in the copy file so it can move to overrides later. Edited by the Indigo Owner and the Indigo Employee (assigned hospitals only). It is NOT built in 2.1a or 2.1b; it is built in step 2.1e. In 2.1a and 2.1b keep every label in the copy file so an override layer can replace it later, and rename Complaints to Symptoms there.

## 3. New step 2.1e: Indigo console

Plan first, then build, as for the other steps. Scope (propose the final list in the plan):

- The Indigo hospitals list from REAL data (the current one is mock) with status, modules and counts.
- Onboard-hospital screen: hospital, branches, access codes, first SuperAdmin, modules; replaces the manual runbook.
- Module switches per hospital and per branch (Indigo only).
- Template library: Indigo Owner creates 2 to 3 templates per print type and logos, assigns them to hospitals; hospitals choose among them. The "several named templates per type, one active" model belongs here.
- Data loading for any hospital (staff, medicines, tests, prices) through the existing Excel engine.
- Terminology per hospital, Indigo-controlled (decided): a small database table of label overrides (hospital, key, text) for a SHORT LIST of about 20 to 30 key terms, one Indigo screen to edit them (Owner and Employee for assigned hospitals; hospital users cannot), a lookup that reads the hospital's text first and falls back to the copy-file default, a short cache so changes show within about a minute, and no deployment. The plan lists the exact key list and what is kept for later.
- Indigo Employee management and hospital assignment (Owner only).
  Cut line: hospitals list, onboard screen and module switches first.

## 4. Updated steps and order

| Step                                       | Items                                                                         | Risk                    |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------- |
| **2.1a** Quick wins                        | 1, 2, 3 (separate documents), 6, 10, 14, 16                                   | Medium                  |
| **2.1b** Roles and access                  | 8, 15, 4, 5, plus Indigo Owner and Employee roles and the template permission | Highest; SECURITY GATE  |
| **2.1e** Indigo console (new)              | section 3 above                                                               | Medium to high          |
| **2.1c** Approvals badge and notifications | 7                                                                             | Low                     |
| **2.1d** Showcase                          | 9, 13, 12                                                                     | Large visual work, last |

Order: 2.1a, 2.1b, 2.1e, 2.1c, 2.1d. Suggested cut order if time is short: dashboard charts beyond KPI cards, then extra templates, then patient card polish.

## 5. Approved build decisions for 2.1a and 2.1b

- Two stacked branches and PRs: `feature/step-2-1a-quick-wins` from `develop`, then `feature/step-2-1b-roles-access` from it. One final report for both; write a PR description for each.
- Keep the stored field name `complaints`; rename labels only. Add `opd_visits.reception_symptoms` (optional, editable until the doctor starts, then read-only). The consultation shows "<Receptionist name>: <symptoms>" and a separate free-text line for the doctor.
- Default print paper A5 for new slip, receipt and prescription presets, as a database setting; saved templates are untouched. Patient card is a 50 x 100 mm label.
- Patient card: print type PATIENT_CARD, exact label page size, preview, test-print page, per-hospital setting for the automatic print after payment, OFF by default. No printer exists to test: build it through normal browser or Windows-driver printing; describe the raw TSPL option in docs, do not build it.
- Date of birth: DOB is the default entry, age the second option. Age entry takes years, months and days and stores an ESTIMATED date of birth (today in the hospital time zone minus the entry), marked as approximate on screens and prints; a real DOB is never overwritten by an age entry. Display: 26 y; 2 y 3 m; 5 m 12 d; under 1 month shows days.
- Receptionist name printed on receipt, slip and patient card (from `created_by`).
- One shared password field with a labelled, keyboard-operable eye button on EVERY password input (login, forgot, reset, activate, change password, My profile).
- Roles: keep the code `BRANCH_ADMIN`, display name "Admin" (may manage one or more branches, assigned in ONE click by Indigo Owner and Super Admin; an Admin cannot assign himself branches; branch scope checked in the database on every call; test a one-branch and a two-branch Admin on every list, report, price and queue). An Admin with several branches signs in with one branch's access code and gets a switcher limited to his branches.
- One sign-in form: a BLANK access code means an Indigo user (login id and password), an access code means a hospital user. Keep the existing login routes and route a blank code in the web layer, unless that is unsafe (then say why); the 14 Postman collections must keep working.
- Indigo user acts inside a hospital through a flagged user row per hospital, with these requirements: (a) hidden from the hospital's Staff list, counts and seat limits; hospital users cannot edit, deactivate or change its roles; no activation email; no staff code consumed; (b) the hospital token is issued only after a valid HQ token, an ACTIVE Indigo user and an ACTIVE hospital, rechecked on every refresh and every hospital switch; the "acting as Indigo" claim cannot be forged; switching hospital issues a new token and ends the old session; Employees only reach assigned hospitals; (c) an append-only access log of enter and exit (ids only, RLS), readable by Indigo and by the hospital's SuperAdmin for their own hospital; (d) one generic error, same status and similar timing, for a wrong id, wrong password and unknown access code, keeping rate limits and lockouts, no account enumeration; (e) `hospigo_hq` is used only for Indigo sign-in and listing hospitals.
- Edit a completed consultation: permission for Admin, Super Admin and Indigo Owner; doctors lose edit and addenda after Complete. Each edit is a new version in an append-only table with RLS (who, when, REQUIRED reason, plain text with a length limit). The original is kept. An edit may ADD tests (they go to tests-to-bill) but never removes or changes a billed test. Prints show the latest version marked "Amended". Old addenda stay as history.
- Doctors see all patients: a new read-only permission for the Doctor role, no edit controls; the OPD queue still shows only their own patients. View log (append-only, RLS, ids only): log every doctor view of a patient unless the doctor has an open visit with that patient; at most one row per doctor and patient per hour. List it as a go-live point (DPDP, manager question 9).
- Print templates and logos: the new permission is held only by the Indigo Owner. Existing hospital-made templates and logos stay and become the active ones. SuperAdmin and Admin lose editing. The named-templates "choose" model is built in 2.1e; in 2.1b only the permission change ships.
- Migrations are named after the latest existing one (check; expected after 20261128110000) and applied ONLY to `hospigo_test`. Update the affected tests, the 14 Postman collections, the e2e tests and `docs/guides/manual-regression-checklist.md`. Claude Code MAY run Newman and the e2e tests, ONLY on the isolated test stack (ports 3100 and 3101, `hospigo_test`), never against Rakshith's dev database.
- Build order inside 2.1b: roles (8), one sign-in and Indigo access (15), version edits (4), doctor patient view (5), then the template permission. If usage runs short: stop at a clean commit boundary and write what is done and what remains into `docs/handoff-phase2.md`.
- SECURITY GATE for 2.1b: after building, self-review as an attacker and report what you tried and found: forged or reused tokens, an Indigo user after being switched off, an Employee reaching an unassigned hospital or patient data, enumeration on the sign-in form, cross-hospital and cross-branch reads, a doctor editing after Complete, a doctor reading without a log entry, a multi-branch Admin reaching an unassigned branch, versions edited or deleted, the access log edited or deleted, and any weakening of an append-only, money or tenant-isolation rule. STOP and report if one would be weakened. Give a verdict.

## 6. For decisions-2-1.md

Add these rows to the decisions table and the reversals table:

- Prescription and Patient report are separate print types (reason: the Prescription goes to the pharmacy, the Patient report is the patient's copy).
- Two Indigo roles, Owner and Employee, with the capability limits in section 2 (reason: only Indigo owners get full power).
- Print templates and logos only by the Indigo Owner; staff, roles, masters by Indigo and hospital SuperAdmin or Admin (reason: Indigo supplies ready-made hospitals; hospitals only choose).
- New step 2.1e (Indigo console) and the order 2.1a, 2.1b, 2.1e, 2.1c, 2.1d.
- Terminology overrides are Indigo-controlled and are decided in 2.1e.
