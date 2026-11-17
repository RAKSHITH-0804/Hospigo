# Hospigo: handoff for the next chat (written 16 Nov 2026, evening)

> **Status update 17 Nov 2026:** Step 3c is merged (PR #41). `develop` is at **c32185f**. Tests: API **281**, web **314**. Phase 2 steps 1, 2, 3a, 3b, 3c are done; Step 3d is in progress. The step table below is superseded by this order: **3d, 4a-1, 4a-2, 4b, 5a, 5b, 6a, 6b, 7, 7b (Settings screens: custom required fields, required-field settings, UHID format creation), 8a, 8b, 9**. Target for the first OPD flow: **Fri 27 Nov** (quality first; never shorten tests or review gates). Details and decisions: `docs/plan-opd-first-flow.md`, `docs/decisions-3c.md`. The rest of this file is the 16 Nov snapshot.

Paste the **starter message** at the bottom into a new chat **inside the same Claude Project**, so the saved project memory is available too. This file holds everything else.

---

## 1. How we work (keep doing this)

- **Rakshith** is a junior developer (graduated ~6 months ago). Hospigo is his first big project. He does everything alone, from requirements to the finished product.
- **Claude is his lead and guide.** Teach new things in plain words: what it is, why it exists, how it works, how we use it here, how to check it. Short plain summary first, then steps.
- **Plan first, approval, then the Cursor prompt.** Nothing is built before he approves. Low tokens. No guessing: if something has not been seen, say so.
- **Cursor prompts:** `TASK`, `RULES`, numbered items, `REPORT`, and end with `git status --short`, `git diff --name-status origin/develop`, `git diff --stat origin/develop`. Builds in **Agent mode** in a **new chat**; read-only inspections in **Ask mode** (Ask mode cannot run commands or edit). A long thread once triggered a false "request blocked": start a fresh chat.
- **Review before commit:** read Cursor's report, ask for greps or diffs of the risky parts, then a hands-on test (Postman collection or browser) **before** any commit. Cursor cannot look at the browser; his eyes are the real UI test.
- **Screenshots:** crop out tokens and passwords. Never paste passwords or tokens into chat. Each chat has an image limit: send fewer, larger crops.
- **Pipeline rules:** one feature branch per step from `develop`; PR into **develop** (the base has slipped to `main` three times, check the dropdown); required check `ci` (the `audit` job is red by design and not required); merge with a merge commit; only release PRs go develop to main. Use `git --no-pager`. Stop dev servers before `npm ci`. Before committing run `git checkout -- apps/web/next-env.d.ts`, `npm run format:check`, and check that `.env` is not staged. Never `npm audit fix --force`. Postman folders (`.postman`, `postman`) are git-ignored.
- **Standing rules:** zero hardcoding (settings, env, theme tokens, one typed copy file for UI text, scan tests enforce it); no table without row level security; money in integer paise, never edited or deleted (reversals only); audit stores field names, not personal values; Sukshema Hospital is only a reference example, never bend the product to it.

## 2. Where the code stands

| Item      | State                                                                  |
| --------- | ---------------------------------------------------------------------- |
| Repo      | GitHub `RAKSHITH-0804/Hospigo` (private)                               |
| `main`    | `312e804`, tag `v0.1.0` (Phase 1). Not updated since                   |
| `develop` | `c32185f` (PR #41 Step 3c, then docs PR #42). Release PR to main later |
| Tests     | API **281**, web **314**                                               |
| Open PRs  | Dependabot #29 and #30 (left for a dedicated upgrade session)          |
| Phase 1   | Done (Steps 1 to 7, staff, HQ and patient login)                       |
| Phase 2   | Steps **1, 2, 3a, 3b, 3c done**; 3d in progress                        |

**Phase 2 steps done:** 1 design docs; 2 OPD masters, settings, mock data (11 tables, price history append-only); 3a number counters (bill, receipt, refund, per-branch token) and patient registry API with permission guard (deny by default, route-scan test); 3b web foundation (permissions in `/auth/me`, one navy/blue palette and IBM Plex Sans for the whole product, collapsible sidebar, top bar, user menu, UI kit, staff copy file).

## 3. Pending Phase 2 steps (in order)

| Step   | What                                                                                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3c** | Reception web: patients. Search, register, record view (tabs Overview, Visits, Bills), edit, registration slip print, the SuperAdmin "**Next UHID number**" card in Settings                              |
| **3d** | SuperAdmin branch switcher (new access token per branch; SuperAdmin only)                                                                                                                                 |
| **4a** | Visits, billing, payments API: visit and token, consultation bill, payments, ledger, queue gate, part payment (permission), Emergency flag, pending dues, counters-only-forward trigger, idempotency keys |
| **4b** | Reception web: visit and billing                                                                                                                                                                          |
| **5a** | Vitals, doctor queue, consultation and prescription API                                                                                                                                                   |
| **5b** | Nurse and doctor web                                                                                                                                                                                      |
| **6a** | Investigations bill and refunds (Admin approves) API                                                                                                                                                      |
| **6b** | Investigations and refunds web                                                                                                                                                                            |
| **7**  | Print templates (settings per hospital) and reports (daily collection)                                                                                                                                    |
| **8a** | NestJS 12 upgrade (before any upload endpoint)                                                                                                                                                            |
| **8b** | Excel upload of masters (fees, tests, medicines, staff)                                                                                                                                                   |
| **9**  | OPD hardening and exit: seed validation, staging check, UI guide PDF with screenshots, Phase 2 report                                                                                                     |

The first working OPD flow is complete after 3c, 4a, 4b, 5a, 5b. **Target Saturday 21 Nov, no slack**; if it slips, cut screen polish, never tests or money rules. Go-live track (outside Phase 2): logging and alerts, backup and restore drill, threat model and DPDP checklist, staging, rollback and runbook, ADRs.

## 4. Key OPD decisions (all confirmed by him)

- Consultation fee per doctor with a visit-type override; **follow-up within 7 days is free** (setting). Registration fee once per patient hospital-wide.
- Bill when the doctor is assigned (before consultation). Part payment only as a permissioned exception (reason, balance tracked). Tax/GST is a hospital setting, off by default.
- **Doctor queue** shows paid, part-paid and Emergency visits. Token: one series per branch per day across all doctors (T1 D1, T2 D4...), **resets automatically at midnight IST**.
- No refund once the consultation started; Admin approves refunds (reversal entries). Unavailable doctor shows "Not Available Now" and cannot be assigned; timings only warn.
- Tests the doctor orders appear automatically on a pending-investigations list at reception. Medicines, tests, fees, staff come by Excel (Step 8b); until then mock masters from the seed.
- Print layouts are hospital settings (paper, full or pre-printed, offsets); slip optional. No prescription templates, no discounts in release 1.
- UHID field label: **"Next UHID number"** (the next new patient gets exactly that number; raise-only; API already behaves so).
- Branch switcher: SuperAdmin only (hospital-wide scope). Others work in the branch of their access code. The top-bar branch chip is a read-only label for everyone.

## 5. Dev environment

- Servers (repo root): `npm run dev -w @hospigo/api` (port 3000), `npm run dev -w @hospigo/web` (port 3001). Open the web app at **`http://127.0.0.1:3001`** (never `localhost`).
- Database: `npm run prisma:migrate -w @hospigo/api`, `npm run prisma:seed -w @hospigo/api`. Tests: `npm test -w @hospigo/api`, `npm test -w @hospigo/web`. Memurai check: `memurai-cli -h 127.0.0.1 ping`. Mailpit: `.\mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025` (only for staff emails).
- Demo access codes: `demo-north-main`, `demo-north-east`, `demo-south-main`, `demo-south-west`. Mock staff and what each role gets: `docs/dev-accounts.md`. Passwords come from `.env` (`SEED_SUPERADMIN_PASSWORD`, `SEED_BRANCH_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`).
- Postman: collection **Hospigo** (login requests save `adminToken`, `receptionToken`, `nurseToken`), environment **Hospigo Local**. Access tokens last **15 minutes**: re-send the logins first. A 28-check registry collection exists (regenerate from `docs/api-opd.md` if needed).
- Design: reception look on the Claude canvas "Hospigo reception UI directions" (artboard D): https://claude.ai/artifact/JzZ9LzAvTUSxZYmspUvVmu . Written spec: `docs/ui-design.md`.
- Docs in the repo: `use-cases-opd.md`, `schema-opd.md`, `system-design.md`, `api-opd.md`, `api-auth.md`, `ui-design.md`, `ui-concepts.md` (original concepts), `dev-accounts.md`, `engineering-tracker.md`, `staging-checklist.md`, `env-reference.md`, `CHANGELOG.md`, `folder-guide.md`.

## 6. Step 3c: what to start with

1. A short **read-only Cursor inspection (Ask mode, new chat)** of the web code built in 3b: UI kit components and props, `callStaffApi`, `requirePermission`, the copy file pattern, how forms submit (server action or route handler) and keep tokens off the browser, existing tests and scans to extend.
2. Read `docs/api-opd.md`. Facts to use: field is `ageYears` (or `dateOfBirth`, never both); duplicate returns **409** `POSSIBLE_DUPLICATE` with `matches`, resend with `confirmDuplicate`; search needs exactly **one** of `uhid`, `phone`, `name` (name at least 3 letters, page size capped); the registering branch is always the token's active branch; UHID never changes; custom fields (DEMO_NORTH only) come from `GET /patients/form-config`.
3. Plan screens from design D: `/app/patients` (search + results table + pagination + quick view), `/app/patients/new`, `/app/patients/[id]` (record view with tabs; Visits and Bills tabs are empty states until 4b), edit, slip print (one default template with its paper size in config; template settings arrive in Step 7), and the "Next UHID number" card in `/app/settings` (needs `hospital.settings.write`).
4. Mock tiles and the doctors card from design D wait for Steps 4 and 5 (no fake numbers in real screens).

## 7. Known follow-ups (not blocking)

API: refresh-token reuse with several web servers (add a grace window before running more than one web server); `pg` deprecation warning after OTP verify; expired OTP row cleanup; counters-only-forward trigger (add with the bill tables in 4a); `number-series-format` requires a financial-year block even for series that never reset; older tests in `patients.uhid.spec.ts` and `access.service.spec.ts` depend on file order; split the long registry search test; staff API calls from the web server had no timeout before the new helper. Web: two tab-list `aria-label`s on `/login` and `/forgot-password` are inline; Next.js 16 wants `middleware` renamed `proxy`; `next/font` downloads the font at build time (vendor the files before go-live); the user menu shows every role as a badge (use "+N" later); Dashboard, IPD, Pharmacy pages are placeholders.

## 8. Decisions still needed from management (Harshad Sir)

OPD release-1 scope; WhatsApp/SMS provider, DLT registration and who pays; tax/GST rules; who may approve part payments; Aadhaar storage, referral consent and data retention (DPDP); Windows or Linux servers and one or two servers for go-live; domain layout; S3 product; data-loss target (nightly backups can lose up to a day; 15 minutes needs continuous log archiving); a paper downtime procedure for hospitals; capacity numbers in `system-design.md` are assumptions; how real hospitals get the Receptionist, Nurse and Doctor roles (only in the dev seed today).

---

## Starter message for the new chat

```
We are continuing Hospigo (Indigo multi-tenant hospital SaaS) in Phase 2 (OPD). I am Rakshith, a junior developer; you are my lead and guide: teach me how things work, plan first and wait for my approval, then give Cursor prompts, review the reports, and give me clear test steps and commit/PR commands. The project memory has the history; the handoff file below has the current state.

State: Phase 2 Steps 1, 2, 3a, 3b are merged on develop (PR #40, 6a05dca; API 245 tests, web 155). Next is Step 3c (reception patient screens), then 3d, 4a, 4b, 5a, 5b, 6a, 6b, 7, 8a, 8b, 9. Target: first working OPD flow by Saturday 21 Nov.

Please start Step 3c: first give me the short read-only Cursor inspection prompt for the web code (Ask mode), then the 3c plan for my approval.

[paste the handoff file here]
```
