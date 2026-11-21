# Hospigo Phase 2, Step 3c: decisions and state (written 17 Nov 2026)

Put this file in the repo as `docs/decisions/decisions-3c.md`. It records what was decided in the planning chat so any tool or person can continue from the repo alone. Read it together with `docs/handoff-phase2.md`.

## 1. State

- Branch: `feature/phase2-step-3c-reception-patients` (from `develop`).
- API part is built, reviewed and verified with three Postman collections (all green): UHID 3c (57 checks), Patients list 3c (101), Patients q search 3c (34). API tests: 281.
- Web screens are built and polished. W1 render speed, W2 live search toolbar, W3 visual fixes are built (section 8); browser-tested 17 Nov (all checks passed).
- **Merged:** PR #41 into `develop` (develop at c32185f after the docs PR #42). Tests at merge: API 281, web 314.
- Later steps, new order (17 Nov): 3d, 4a-1, 4a-2, 4b, 5a, 5b, 6a, 6b, 7, 7b (Settings screens), 8a, 8b, 9. The Sat 21 Nov target was dropped; the new target is Fri 27 Nov, quality first (see `docs/plans/plan-opd-first-flow.md`).

## 2. API decisions

- `GET /patients/uhid/start-number` (permission `hospital.settings.read`) returns `{ nextNumber, nextUhidPreview, resetRule, periodYear, periodLabel }`. Read only: no counter row, no increment, no audit.
- `PUT /patients/uhid/start-number` now raises the counter of the CURRENT period (period 0 for never-reset hospitals, the current financial year otherwise). Raise-only; equal to the current next number is allowed.
- UHID formats are per hospital (blocks: fixed text, branch code, financial or calendar year, separator, running number). The `number-series-format` rule that demands a financial-year block applies to bill, receipt and refund numbers only, not to UHID. There is no screen or API to create a UHID format yet (set by seed or script until Step 7b; needed before a real hospital goes live).
- `GET /patients` (new): sort `newest | oldest | name_asc | name_desc` (default newest, by created_at), page, pageSize (existing cap), at most one filter (`uhid | phone | name`), or free-text `q`. Items add `createdAt` and `registeredBranchName`. Index on `(tenant_id, created_at, id)`.
- `q` matches by prefix, case-insensitive: any word of the name, the UHID, or the phone digits. LIKE wildcards in `q` are literal. `q` plus another filter = 400. Too short = 400 with `fieldErrors.q = INVALID`. Known limit: no contains-search (for example last 4 digits of a phone); very large tables need a pg_trgm index.
- Always required in code (cannot be switched off by a hospital): name, age-or-date-of-birth (exactly one of `ageYears` / `dateOfBirth`), phone. Everything else is a per-hospital setting; the demo seed leaves all other fields optional. PATCH cannot blank the three.
- Validation errors return the old `message` plus `fieldErrors: { key: CODE }` with codes `REQUIRED | INVALID | AGE_AND_DOB_BOTH`. Keys: form-config keys, `custom.<code>` for custom fields, `ageYears` for the both-sent case. All errors from all stages come back in ONE 400. No UI text in the API.
- Pincode: exactly 6 digits when given.
- Form-config returns a `section` on every field (`PERSONAL | CONTACT | ADDRESS | RELATIVE | OTHER`), grouped in section order. Custom fields have a section column (default OTHER). DEMO_NORTH title, relation and relative name are RELATIVE.
- Dev seed: about 60 fake patients per demo hospital, created through the real UHID allocator, created_at spread over 30 days, idempotent (skips when the tenant already has 60 or more patients), runs only under the development seed guard.

## 3. Web decisions

- Forms are client components calling Next route handlers (no server actions); the access token never reaches the browser; no patient data in browser storage.
- Silent session renewal: the refresh cookie is scoped to `/api/auth`, so `POST /api/auth/refresh-session` renews it (JSON only, never redirects). One client helper retries a failed call once after one shared refresh. If renewal fails the form keeps every typed value and shows a "Sign in again" link that opens in a new tab.
- Registration slip is a browser print view (print CSS, `@page` generated from one config value). No PDF until the Step 7 print templates.
- Final rule: no hardcoding. Field lists, required flags and sections come from form-config. Sort options, lengths, prefix, delays, field grid spans and formats come from config files. UI text only in `staff-copy.ts`. Sizes only as tokens in `globals.css`.
- Patients page: one toolbar row (search box + Search button), Register patient at the top right of the title row. No "Search by" selector, no separate sort block, no top-bar search. One blue (X) clear icon inside the box. Live search after a short delay using `GET /patients?q=`. Sorting lives in the column headers: UHID (new/old), Name (A-Z / Z-A), Registered on (new/old).
- Register/edit form: 12-column grid, spans from a config map, Age-or-Date-of-birth in ONE cell (default Age), phone with fixed +91 prefix (10 digits), pincode 6 digits, relative details (title, relation, relative name) in a collapsed block, Register/Cancel in the header, back arrow (small ghost button). Required fields show a red asterisk; on Save every missing or invalid field is marked at once and the first is focused. Target: no scrolling at 1366x768.
- Density tokens: 13px body, 32px controls, 12px labels, radius 4-6px, 40px table rows. The 16px input font applies only on touch screens.
- The OPD queue page stays sample data until Steps 4b and 5b.

## 4. Deferred to Step 7 / 7b (Settings screens)

- SuperAdmin adds their own fields, marks them required, and picks their section.
- Settings for gender, area and state requirements (not required by default).
- A way to create a hospital's UHID format.
- Print templates (paper, offsets) per hospital.

## 5. Web prompt W1, W2, W3 (done)

W1 render speed: measure first; one session lookup per request (React cache); `staffRoute` checks only that the access cookie exists and maps upstream 401/403 (the API stays the authority); parallel server fetches; first-paint data fetched on the server; loading.tsx skeletons; no router calls per keystroke; smaller client bundles.
W2 live search toolbar as in section 3.
W3 visual fixes: small back arrow; 16px input font on touch only; age/DOB group radius; record page card padding and quiet headings; estimated DOB shown as "Age 33 years (approx.)" with no date; one spaced phone format everywhere.

## 6. Browser test (done 17 Nov, all passed) (reception, north, `http://127.0.0.1:3001`)

Fixed shell; toolbar and live search; header sorting and URL; quick view; register form on one screen; all-fields highlight; digits-only phone, pincode, age; age/DOB switch; relative block; register, duplicate panel, edit, slip print preview; SuperAdmin Next UHID card (raise, then register and compare); south hospital list; session test (delete the access cookie: silent; delete both: message and kept values); phone width.

## 7. Follow-ups (not blocking)

- Edit cannot clear a filled field (empty means omitted).
- Soft DTO validation converts values implicitly: a text `"false"` for `confirmDuplicate` reads as true. The web sends a real boolean; remove the implicit conversion for that field.
- GET list/uhid errors are mapped to 400 with the raw message; a real server fault would also show as 400.
- Partial (contains) search for phone and UHID needs an API change.
- Seed data cosmetics: generated names do not match genders.
- Existing items from the handoff (refresh-token reuse with several web servers, pg deprecation warning, expired OTP cleanup, counters-only-forward trigger in 4a, older tests that depend on file order, vendor the font files before go-live) remain open.

## 8. W1–W3 outcome (written 17 Nov 2026, proposed, uncommitted)

- `getSession` is wrapped in React `cache()`: layout, page and guards share ONE `/auth/me` per navigation. `AuthGuard` is an empty client component (no auth); both wrappers stay for now.
- `staffRoute` checks only that the access cookie exists (JSON 401 `UNAUTHORIZED`) and maps upstream 401 → `SESSION_EXPIRED`, 403 → `FORBIDDEN`. The `permission` option is removed. This is safe because the API denies by default (`@TokenKinds('HOSPITAL')`, `@RequirePermission` on every patients route, `PermissionGuard`, route-scan test).
- Pages fetch first-paint data on the server with `callStaffApi` (`lib/patients/server.ts`) and pass props; client components fetch only on user actions. A server fetch that gets 401 redirects to `/api/auth/refresh?next=…` (path sanitized, same-origin only). Independent fetches run in `Promise.all`.
- Search: web minimum length 2 (`WEB_PATIENT_SEARCH_MIN_LENGTH`), pause 250 ms (`WEB_PATIENT_SEARCH_DEBOUNCE_MS`), max 64 (`WEB_PATIENT_SEARCH_MAX_LENGTH`). A 400 with `fieldErrors.q` shows the hint. `classifyQuery` and the web `/search` route are removed.
- Record page: estimated date of birth shows “Age N years (approx.)” and no date; a real date is shown like table dates; phone is spaced everywhere except the slip (stored format).
- Input font: 13px on desktop, 16px on touch only.
- Not done: lazy-loading the quick-view panel (it is small and inside the list client component, no real saving).

## 9. F1–F4 outcome (proposed, uncommitted)

- `GET /patients` sorts: `uhid_desc` / `uhid_asc` = `length(uhid)` then `uhid COLLATE "C"` then `id`. Plain character order matches the Postman check. Known limit: after a UHID format change, formats are ordered by length then text. An unknown sort value is still `400 Invalid sort`; the web falls back to the default for an unknown `?sort=` and derives `col` from `sort`.
- Web UHID header: first click `uhid_desc`, then `uhid_asc`.
- Tooltips are portals on `document.body`, rendered only after mount. Collapsed sidebar text uses `.visually-hidden`.
- Settings is a framed, multi-section page driven by one config list; `/app/settings` redirects to the first allowed section. Later steps add one entry.
- Slip: `@page` margin from config (default 0) and its own padding token.

## 10. More follow-ups found in the 3c browser test (17 Nov 2026)

- Record page: the section headings (Demographics, Contact, Address) are larger than the headings on the form and in Settings.
- Duplicate panel shows only UHID and name; it should also show phone, age and branch (the 409 matches need to carry them).
- The tooltip spec prints React act() warnings (noise, not failures).
- The empty AuthGuard client wrappers (mounted twice) can be removed.
- The route-safety Postman collection needs a valid patientPhone for its five patient-token checks (they are skipped without it).
