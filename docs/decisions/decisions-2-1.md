# Decisions: Phase 2.1 (demo changes)

Source: `docs/plans/phase-2-1-demo-changes.md`, written by Rakshith (with Claude) on 26 Nov 2026 after the manager demo of Phase 2 (OPD). The next meeting is with hospitals, so the product must look real and the workflow must match how hospitals like Sukshema work. Phase 2.1 is built in four steps, each its own branch, PR and report: 2.1a, 2.1b, 2.1c, 2.1d. This file is updated as each step finishes.

Phase 2 (Steps 1 to 9) is merged into `develop` (Step 9: PR #62, merge commit `ef46910`).

## 1. Decisions (Rakshith, 26 Nov 2026)

| #   | Decision                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Indigo users act as **Tenant Admin** inside hospitals: full configuration power, patient data visible, every view and every cross-hospital action logged and audited.                                                                                                                                                                   |
| 2   | A completed consultation can be edited only by Super Admin and Admin (and Tenant Admin). The ORIGINAL IS KEPT; every edit saves a new version with who, when and why. Tests that were already billed follow the refund rules and are never silently changed.                                                                            |
| 3   | Doctors see ALL patients of the hospital, read-only, with full history at once (no referral, no approval). The OPD queue still shows only their own assigned patients. Every view by someone other than the assigned doctor is logged (who, which patient, when). The manager still has to confirm the DPDP point (manager question 9). |
| 4   | An Admin with several branches signs in with the access code of one of his branches and gets a switcher limited to his assigned branches.                                                                                                                                                                                               |
| 5   | The patient card is built END TO END through normal browser or Windows-driver printing with an exact label page size, a preview and a test-print page. There is NO printer to test with, so do NOT build raw TSPL commands; describe that option and the hardware it needs.                                                             |
| 6   | Symptoms entered by reception are optional and editable until the doctor starts; they are printed on the patient report.                                                                                                                                                                                                                |
| 7   | Age entry covers years, months and days (for babies).                                                                                                                                                                                                                                                                                   |
| 8   | The next demo date is NOT confirmed: keep the order 2.1a, 2.1b, 2.1c, 2.1d and give a cut line.                                                                                                                                                                                                                                         |
| 9   | Demo data uses fictional hospital names that do not match real hospitals, and Indian names from different regions.                                                                                                                                                                                                                      |

## 2. Earlier rules this phase REVERSES

Each row records the old rule, the new rule and the reason. The old rule stays in the earlier decisions files as history; where they disagree, this file is right from the step that builds the change.

| Earlier rule                                                                           | New rule                                                                                          | Reason                                                                                                         | Built in |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| A completed note is frozen; the doctor adds addenda                                    | Only Super Admin, Admin and Tenant Admin edit it, as new versions (original kept, who, when, why) | Hospitals need corrections; a doctor must not rewrite a finished record, an Admin can, with a trail            | 2.1b     |
| Admin roles have no clinical rights; SuperAdmin only reads the queue, vitals and notes | Admin and Super Admin may edit consultations                                                      | Same as above                                                                                                  | 2.1b     |
| Records are shared between doctors only through referral                               | Doctors see all patients hospital-wide (read-only, viewing logged)                                | When Doctor 1 is away, reception assigns Doctor 2, who needs the history at once; the log keeps it accountable | 2.1b     |
| Separate Indigo HQ login with no access to patient data                                | Indigo users sign in without an access code and act as Tenant Admin inside a hospital             | One sign-in form; Indigo staff must be able to configure and support hospitals; every action is audited        | 2.1b     |
| The hospital SuperAdmin makes print templates and logos                                | Only the Tenant Admin does; hospitals choose among the templates                                  | Designed, consistent templates; hospitals should not break their prints                                        | 2.1b     |
| Role "Branch Admin" is for one branch                                                  | Role "Admin" can manage one or more branches                                                      | Some hospitals have one Admin for two or more branches                                                         | 2.1b     |
| The branch switcher is for SuperAdmin only                                             | An Admin with several branches gets a switcher limited to his branches                            | Follows from the line above                                                                                    | 2.1b     |

## 3. Items and steps

| Step                                  | Items                  | Risk                                                           |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| **2.1a** Quick wins and clinical flow | 1, 2, 3, 6, 10, 14, 16 | Medium; migrations for symptoms and estimated date of birth    |
| **2.1b** Roles and access             | 8, 15, 11, 4, 5        | Highest; includes a SECURITY REVIEW gate                       |
| **2.1c** Approvals and notifications  | 7                      | Low                                                            |
| **2.1d** Showcase                     | 9, 13, 12              | Large visual work; data first, then templates, then dashboards |

Suggested cut order if time is short: item 12 charts beyond the KPI cards, then item 13 extra templates, then item 6 label polish.

## 4. Per-step notes

(Filled in as each step finishes: what was decided that was not in the plan, what was not done, follow-ups.)
