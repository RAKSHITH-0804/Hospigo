# Hospigo UI design (current look)

Single visual identity for the whole product (Phase 2 Step 3b). Token values live only in `apps/web/src/app/globals.css` (`:root`). The original Step 5b concept screens in `docs/Hospigo_UI_concepts.pdf` and `docs/ui-concepts.md` are kept for history only. A screenshot guide will be added at Phase 2 Step 9.

## Palette and font

| Role            | Token                                                                         | Notes                                            |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Page background | `--background`                                                                | Soft blue-grey                                   |
| Text            | `--foreground` / `--muted-foreground`                                         |                                                  |
| Surface         | `--card`                                                                      | White                                            |
| Border          | `--border`                                                                    |                                                  |
| Input fill      | `--input`                                                                     | White surface                                    |
| Input border    | `--input-border`                                                              | `oklch(0.554 0.046 257.4)` ≈ **4.61:1** vs white |
| Accent          | `--primary` / `--ring`                                                        | Buttons and focus                                |
| Sidebar         | `--sidebar` (+ foreground, accent, border, muted)                             | Navy / login brand panel                         |
| Radii           | `--radius-card`, `--radius-control`, `--radius-badge`                         |                                                  |
| Sidebar widths  | `--sidebar-width` (`13.5rem`–`16rem`), `--sidebar-width-collapsed` (`4.5rem`) | Animated unless `prefers-reduced-motion: reduce` |
| Sidebar mark    | `--sidebar-mark-size` (`2.5rem` ≈ 40px)                                       | Expanded + collapsed                             |

**Font:** IBM Plex Sans (400–700) via `next/font/google` as `--font-sans`.

## Application frame

Expanded (header is two rows: brand row, then full-width hospital name):

```
+--------------------------+------------------------------------------+
| [H] Hospigo        [|=]  | [pin Branch…]                     [User] |
| Hospital name (ellipsis + tooltip)                                  |
| Dashboard → Patients → modules…                                     |
| …Settings (if allowed)   |         #main-content (scrolls)          |
| Powered by Indigo        |                                          |
+--------------------------+------------------------------------------+
```

Collapsed (40px mark, then collapse control; hospital name not shown visually):

```
+------+------------------------------------------+
| [H]  | [pin Branch…]                      [User]|
| [|=] |                                          |
| [ic] |         #main-content (scrolls)          |
| [ic] |                                          |
| logo |                                          |
+------+------------------------------------------+
```

Sidebar and top bar stay fixed in the viewport; only `#main-content` scrolls. There is no top-bar patient search.

- **Brand row:** `--sidebar-mark-size` mark + full “Hospigo” wordmark (`whitespace-nowrap`, no ellipsis, `flex-shrink: 0`) + collapse, vertically centered. Only the hospital-name row ellipsizes.
- **Collapse:** `PanelLeft` ghost button, 44px, tooltip + Kbd (`Ctrl`/`Cmd`+`B`). Shortcut ignored in inputs. `aria-expanded` + `aria-controls`.
- **Expanded hospital name:** own row under brand/wordmark/collapse; full text in DOM; CSS ellipsis; Tooltip on hover/focus (`tabIndex={0}`).
- **Collapsed nav:** 44×44 icon buttons, custom tooltip (`role="tooltip"`, `aria-describedby`) on hover/focus; Escape dismisses. Nav body scrolls; header/footer stay put.
- **Settings:** last main-nav item when `hospital.settings.read` (not a separate footer block).
- **Footer:** `PoweredBy` from `apps/web/src/config/branding.ts`. When `indigoLogo` is null → muted “Powered by Indigo” text (hidden when collapsed). When set → image (`public/brand/` white-on-dark SVG).
- **Skip link:** first focusable control → `#main-content`.
- **Branch chip:** read-only for every hospital user (map-pin + ellipsis). Not a control.

**Branch switcher (Step 3d):** visible only to users whose role has hospital-wide scope (SuperAdmin). Branch Admin and other staff work in the branch of the access code they logged in with; for them the branch chip stays a read-only label. Built in Step 3d: the chip becomes a dropdown (list loaded when opened, skeleton, error states); switching rotates the session and issues a new access token for the chosen branch (server-side check, audit entry, tests), then the page reloads. A tab that regains focus re-checks the branch and reloads if another tab switched.

## User menu (~280px)

```
+--------------------------------+
| (SS)  Name                     |
|       email@… (tooltip=full)   |
|       [Role] [Role] … (wrap)   |
|--------------------------------|
| Branch      value              |  (hospital users)
| Hospital    value              |  (HQ: HQ title, no branch)
|--------------------------------|
| [icon] Sign out                |
+--------------------------------+
```

Email keeps CSS ellipsis; full address via Tooltip (focusable with `tabIndex={0}`). Role badges share one flex-wrap row.

## Rules

1. No colour or fixed px in components — tokens only (`theme-hardcode.spec`).
2. Staff UI copy from `staff-copy.ts` (`staff-ui-copy-scan.spec`).
3. Do not hardcode hospital names.

## Go-live Indigo logo

1. Add a white-on-dark SVG under `apps/web/public/brand/` (e.g. `indigo-lockup.svg`).
2. In `apps/web/src/config/branding.ts` set:

```ts
indigoLogo: { src: '/brand/indigo-lockup.svg', alt: 'Indigo', width: 96, height: 24 }
```

## UI kit

Badge, Field (Input/Select with `--input-border`), Tabs, DataTable, Pagination, Kbd, PageHeader, Tooltip.

Density tokens live in `globals.css` (control ~32px, body/label ~13/12px, card radius 6px, card padding 16px, table row ~40px). Components consume tokens only — no size literals.

**DataTable:** optional `sortable` column headers (button + arrow, `aria-sort`). Patients list maps UHID/Name/Registered columns to API `sort` plus URL `col=` marker.

**PageHeader:** optional `backHref`: a small ghost icon button (no bordered box, 16px icon, hit area from `--size-icon-button`, at least 28px) on the title line, `.no-print`. Section headings (form, record cards, quick view) use one small quiet uppercase style (`.section-heading`). Inputs and selects use the control font token (13px); the 16px size applies only under `@media (pointer: coarse)`. The age/date-of-birth switch and its input share the control radius. Record page: values compact, 1/2/3 columns by width; an estimated date of birth shows only “Age N years (approx.)”; phone is shown spaced (`+91 xxxxx xxxxx`) in table, quick view and record.

## Patients list and form

- **List toolbar:** title row = page title at the left and Register patient at the top right (write permission only); under it ONE row — search box (magnifier icon, plain text input, one small blue X inside the box when it has text) + Search button, both at the 32px control size. No Clear button, no native clear icon, no “Search by” select, no separate sort block. Live search: after the configured pause (default 250 ms) and the configured minimum length (default 2) the web calls `GET /patients?q=`; Enter or Search runs at once; the previous request is cancelled and late answers are ignored; old rows stay (dimmed, `aria-busy`) while loading. Shorter text shows a hint and keeps the list. A plain count line (“N patients found for “x””) and an empty state replace the old chip. `?q=` lives in the URL via `history.replaceState` (no navigation per keystroke).
- **Table sort:** column headers only; default Registered on / newest.
- **Register/edit:** 12-col grid (6 medium, 1 phone) with spans from `PATIENT_FORM_FIELD_SPANS` / data-type defaults. Age-or-DOB is one cell with an Age/Date mode switch (default Age). Register and Cancel sit in the page header (`form="patient-form"`). Relative details use a chevron disclosure. Empty selects show “Select …”.

## Tooltips, sidebar and settings (F1–F4)

- **Tooltips:** one `Tooltip` component renders its panel in a portal on `document.body` after mount (no hydration mismatch), fixed to the trigger's bounding rect (right or below), z-index from `--z-tooltip`, `pointer-events: none`. It closes on Escape, blur, mouse leave, scroll and resize. The sidebar's scroll container can no longer clip it.
- **Collapsed sidebar:** item labels, group labels, the brand wordmark, the hospital name and the "Powered by" text carry `.visually-hidden` (screen readers still read them); nothing else is visible.
- **UHID header:** first click = highest UHID first (`uhid_desc`), second click = `uhid_asc`; plain character order, shorter UHIDs first when ascending.
- **Settings:** left section list (`nav`, `aria-current`), built from `config/settings-sections.ts`; on narrow screens it becomes a horizontal list. Content area max width `--size-settings-content-max`. Each setting is a compact block: quiet heading, one-line description, current value, inline form (number input `--size-field-narrow`, reason input `--size-field-medium`, Save next to them). `/app/settings` redirects to the first allowed section; an unknown section shows a not-found state; no `hospital.settings.read` = the usual no-permission redirect.
- **Slip:** `@page` margin comes from `WEB_PATIENT_SLIP_PAGE_MARGIN` (default 0, which removes the browser's date/URL header and footer); the slip has its own `--space-slip-padding`.
- **Register form:** the selected Age / Date of birth mode is filled with the primary token.

## Reception: visit, bill and receipt (Step 4b)

- **New visit** (`/app/patients/[id]/visits/new`): button on the patient record, visible only with both `opd.visits.create` and `opd.billing.collect`. Doctors of the active branch as radio rows with the fee of the chosen visit type; an unavailable doctor is disabled with "Not Available Now"; "outside usual timings" is only a badge. New / Follow-up toggle. The bill box shows the server's **preview** (lines and total); the button reads "Take cash ₹600.00" (or "Create visit (nothing to pay)" for a free follow-up). The click sends the shown total (`expectedTotalPaise`) and one idempotency key: kept for retries of the same choice (network error, silent session renewal), replaced when the choice or the total changes; a double click makes one request. `PRICE_CHANGED` shows the new total and nothing is charged. A warning appears when the patient already has a visit with that doctor today.
- **Receipt** (`/app/opd/visits/[id]/receipt`): hospital, large token, bill and receipt numbers, patient, doctor, date, branch, lines, total, paid and mode. Browser print view (`@page` from `WEB_RECEIPT_PAPER_SIZE`, default A5, margin `WEB_RECEIPT_PAGE_MARGIN`); the shell is hidden when printing.
- **Visits and Bills tabs** on the patient record: server-rendered, paginated with plain links (`?tab=visits&vp=N`, `WEB_OPD_VISITS_PAGE_SIZE`, default 10), active branch only. Without `opd.visits.read` the tabs say so; money and receipt links need `opd.billing.read`.
- Money is shown from whole paise only (`config/money.ts`: `₹600.00`, Indian grouping); a fractional amount throws instead of being shown.

- **Free repeat visit** (Step 4a rule): when the preview says `repeatVisitFree`, the bill box shows "Repeat visit with the same doctor inside the free period: no consultation fee." and the button reads "Create visit (nothing to pay)"; the receipt line says "Free repeat visit".

- **Payment box** (Step 5a-1, New visit): one row pays the whole total with the default mode ("Take cash ₹600.00"). "Add payment mode" turns it into a split (UPI + cash ...): per row a mode, an amount in rupees and, for modes that need it, a reference no.; a line under the rows says "Still to collect: ₹300.00", "Entered ₹50.00 more than the total" or "Total covered". The button ("Take payment ₹600.00") stays disabled until the rows add up exactly. The receipt shows ONE receipt number and each mode with its amount.

- **OPD queue, vitals and consultation** (Step 5b): `/app/opd` is the real queue (a doctor's own waiting patients or the whole branch for a nurse; auto-refresh every few seconds, a Refresh button, a failed refresh keeps the list). `/app/opd/visits/[id]/vitals` records and corrects vitals (a changed reading asks for a reason; history is shown). `/app/opd/visits/[id]/consult` is the doctor's screen: note, prescription rows (medicine list search or typed name flagged "unlisted"), explicit "Save draft" and "Complete consultation" plus **auto-save** a few seconds after the last keystroke (status line, warning when closing the tab with unsaved text). A completed consultation is read-only with addenda. Details and the click path: `docs/decisions-5b.md`.

- **Consultation screen details** (Step 5b, after the first manual test): note boxes start small and grow as the doctor types; the prescription is one line per medicine with "Add medicine" under the lines (Enter in the last finished line adds the next); the follow-up date uses the calendar popover with quick picks; vitals sit on one page in a grid; the queue keeps patients from earlier days and tags them. See `docs/decisions-5b.md`.

## Tests, refunds and cancelling (Step 6b)

- **OPD tab strip** (Queue, Tests to bill, Refund requests): plain links under the page title, only on those three top-level pages, each only for staff who may use it. One section alone is not shown on its own page.
- **Doctor, Tests box** (`/app/opd/visits/[id]/consult`, under the prescription): search box, chips with a status word (Ordered, Billed, Not taken: reason; an unknown status reads "In progress"), a remove button only while a test is just ordered, no prices. Saved with the note by the same auto-save; read-only after completion.
- **Reception, Tests to bill** (`/app/opd/tests`): a table (token, patient, doctor, tests, Bill tests) and, beside it on a wide screen, the billing card for the chosen patient: every test with a tick and its price (unticked asks "Why is X not taken?"), the total, the same Payment box as New visit, and "Take cash ₹X" / "Take payment ₹X". Afterwards "Tests billed" with Print receipt. The tests receipt is the visit receipt print view with each test named.
- **Tests of a visit** (`/app/opd/visits/[id]/tests`): tests with status, tests bills with Print receipt and Request refund.
- **Request refund and Cancel visit:** a button that opens a small inline form (amount in rupees, filled with the most that can be returned; reason; Send request). Cancel visit only on a WAITING visit. After sending it says an Admin will decide.
- **Refund requests** (`/app/opd/refunds`): filter links Open, Approved, Rejected, All; table (requested, patient, bill and type, amount and what can still be returned, reason, asked by, status, decision). Approve (optional note, asks for a UPI reference only when needed) and Reject (note required) for staff with `opd.refunds.approve`; read-only for reception. A decided row shows who, voucher number, each mode returned and the note.
- Details, click path and follow-ups: `docs/decisions-6b.md`.

## Settings pages (Step 7b)

- Left menu: Registration fields, Patient numbers, OPD rules, Printing (`apps/web/src/config/settings-sections.ts`; one entry per page).
- Registration fields and Patient numbers use the full width: two blocks side by side (`.settings-columns`), stacked on narrow screens. Column and field widths are tokens in `globals.css` (`--size-col-check`, `--size-col-action`, `--size-column-min`).
- Field tables (standard and own fields) share one header row and four columns (field, Ask on form, Must be filled, action) so the checkboxes line up. Section and type are small text under the field name.
- "Saved." appears next to the change and fades after `settingsScreenConfig.savedMessageMs` (`config/settings.ts`); an error stays until the next action. The line keeps its height, so nothing jumps.
- Every settings page has an **About this page** help block (`components/settings/settings-help.tsx`, text in `staffCopy.settings.help.pages`, keyed by section id). It is closed until the user clicks "Show help"; nothing is stored. A new settings page must add its help text (a test fails otherwise).
- Rows with several inputs keep every input the same height: hints go in a note or a hover title, never as a line under one input of a row.

## Doctor pages (Step 7c)

- **My profile** (`/app/profile`): reached from the user menu (top right) for people with `opd.doctors.own`. Two blocks side by side: the form (name as printed, qualifications, speciality, registration number; login name, department and branches shown as text) and a preview of how it prints. A reminder box lists the empty details. Help block closed until "Show help".
- **Doctors** (Settings, `/app/settings/doctors`, needs `opd.doctors.read`): one card per doctor with what prints, the department and the branches; "Details missing" tag; Edit opens the five fields (including the department). Cards, not a table, because a doctor has too many details for aligned columns.
- The consultation screen shows a quiet note with a link to My profile when the registration number is empty; Complete is never blocked.

## Use of space (standing rule, 21 Nov 2026)

Rakshith's rule for every page: no big empty areas and no scrolling that is not needed. Wide screens use blocks side by side (`settings-columns`, `settings-doctors`: `auto-fit` grids with a minimum width token); narrow screens stack them. Page and block titles are not repeated; an empty description renders nothing; a confirmation line takes no room until it has something to say (`settings-flash-lazy`) unless a jump would hurt (tables). Detail goes in a hover tip or the help block. Check phone, tablet and wide widths before calling a page done. Pages built before this rule have not been checked against it yet (see the handoff).

## Space review of the older pages (22 Nov 2026)

Reviewed as SuperAdmin at wide (1440), about 800 and phone (390) widths in the built-in browser; every change was approved by Rakshith first. Done:

- **Tables** (`DataTable`): `hideOnPhone` drops a column on a phone, `nowrap` keeps a phone number on one line, `stackOnPhone` turns each row into a small card (for tables not sorted by their header). Every cell carries `data-label` with its column name. Patients list: gender, branch and registered date are hidden on a phone. OPD queue: cards on a phone.
- **PageHeader**: the title block takes the free width (`basis-48`), so an action button (Refresh, Print) stays beside the title instead of dropping below the description.
- **OPD queue**: the filter tabs and the status line share one row.
- **Collection report**: the Print menu and Clear filters are in the page header (`ReportActions`), the seven filters fit one row on a wide screen (`minmax(9.25rem, 1fr)`), and the report tables sit two side by side (`report-sections`; the tests table takes the whole row).
- **Patient record**: the blocks sit side by side (`patient-record-grid`) and the fields in a block use as many columns as the block is wide (`record-cols`, `auto-fit`).
- **Dashboard**: no longer an empty "Coming later" page. It shows quick links for what the person may do (`QuickLinks`, one permission per link), with no numbers.
- **Doctors settings**: two details per row on a phone.
- **Left as it is**: the receipt, slip and prescription preview shows the sheet at its real paper size, so empty space beside it is part of showing real paper. Register patient already fits one screen. Refund requests is fine.
- **Not reviewed yet** (needs a login of that role): the editable consultation screen, vitals, reception visit and billing screens, tests billing, the login and patient portal pages and the HQ admin pages.
