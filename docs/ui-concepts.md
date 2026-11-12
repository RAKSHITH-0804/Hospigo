# Hospigo UI concepts (Phase 1 Step 5b)

Short description of the four concept screens. Taken from `docs/Hospigo_UI_concepts.pdf`, with the corrections below. **Sign-in is real (Step 6d)**; HQ/hospital/booking content pages still use mock data with a Sample data badge until later steps.

## Theming and fluid layout

This UI is a **sample**. Colours, radius, spacing, and font sizes may change at go-live.

**Rules**

- No hardcoded colours or sizes in components. Everything comes from named theme variables in `apps/web/src/app/globals.css` (or utility classes that only reference those variables).
- Mock content stays under `apps/web/src/mock`; components never embed fake hospital data.
- Layout scales fluidly with `clamp()` tokens so phones, tablets (portrait and landscape), laptops, and large desktops all use the available width — no half-empty tablet layouts driven by fixed device breakpoints.
- **Min-height only:** `--viewport-min-height` is a minimum. Never a fixed height, never max-height, never `overflow: hidden` on `html`, `body`, or page wrappers. Pages grow with content and use normal document scrolling. Bottom padding uses `--space-page-bottom` (includes safe-area inset).
- **Top-aligned content:** Extra viewport height must not stretch gaps between sections. Leftover space stays at the bottom of the page/card.

**Token names (values live only in globals.css)**

- Type: `--font-size-body`, `--font-size-label`, `--font-size-heading`, `--font-size-title`, `--font-size-small`, `--font-size-stat`, `--font-size-input` (floor ≥ 1rem / 16px)
- Spacing: `--space-1` … `--space-6`, `--space-section`, `--space-page-x`, `--space-page-y`, `--space-page-bottom`, `--space-card-padding`, `--space-table-x`, `--space-table-y`, `--space-login-bar-y`, `--space-login-panel`, `--space-selection-x`, `--space-selection-y`, `--space-chip-x`, `--space-chip-y`, `--safe-area-bottom`
- Controls: `--size-input-height`, `--size-button-height`, `--size-touch`, `--size-header-height`, `--size-icon-menu`, `--size-selection-min-height`
- Containers: `--size-content-max`, `--size-form-card-max`, `--size-sidebar`, `--size-sidebar-mobile-max`, `--size-branch-select`, `--size-stat-card-min`, `--radius-card`, `--viewport-min-height`
- Colour (kept): `--primary`, `--login-brand`, `--surface-tint`, `--module-chip-*`, `--status-*`, `--brand`, and the shared shadcn palette tokens

**Breakpoints (defined once in globals.css)**

- `--breakpoint-layout` / media `43.75rem` (~700px): two-column layouts, login split, shell sidebar
- `--breakpoint-table` / media `40rem` (~640px): HQ hospitals table vs stacked cards

Media queries cannot reliably read CSS variables, so the rem literals match the `@theme` breakpoint tokens and are documented beside them.

## Corrections from the PDF

- The HQ platform health wording uses **Storage**, never a third-party object-store name. Example card text: `Database, Redis, Storage, WebSocket: all up`.
- Hospital names are clearly fake demo names (for example Demo Hospital One / `DEMOONE`). They live only under `apps/web/src/mock`.
- Sign-in and booking form fields start **empty** (no pre-filled values).
- **Colours:** Hospigo / Indigo HQ screens use teal theme tokens. The hospital staff app and the public booking page take the hospital brand colour from mock config through CSS variables (`BrandScope`).
- Viewing mock screens never changes data. Call next patient and Send OTP do nothing real. **Sign in** posts to the Next auth BFF (Step 6d).
- Patients never see hospital access codes on the public booking page. Access codes appear only on staff login and the HQ hospitals list.

## 1. Sign in (`/login`)

- **Phone (below layout breakpoint):** slim teal top bar shows only “Hospigo”. Headline and Indigo tagline are hidden. Sign-in card sits directly under the bar so Sign in stays reachable without scrolling on common phone sizes (e.g. 375×667, 360×800). Full viewport height via `--viewport-min-height` (min-height only).
- **From layout breakpoint up:** full-height split — brand panel with “One platform. Every hospital.” and “A product by Indigo”, card on the right.
- Tabs: **Hospital staff** (access code, email, password) and **Indigo HQ** (email, password only).
- Real form: Hospital staff (access code, email, password) or Indigo HQ (email, password). Generic error / rate-limit / unavailable copy from session config. No Sample data badge on login. Sign in uses the theme primary (teal). Forced password change goes to `/change-password`.
- **Forgot password?** under the form → `/forgot-password` (HQ tab uses `?tab=hq`). After reset/activate, `/login?notice=password-updated` shows a one-time success line from session config.

## 1b. Forgot / reset / activate (Step 6b part B)

- **`/forgot-password`:** same login split look; tabs Hospital staff (access code + email) and Indigo HQ (email). Every successful submit shows the neutral confirmation from config (“If an account exists…”). Rate-limit / unavailable copy matches login.
- **`/reset-password` and `/activate`:** new password + confirm; loading / error / retry; form stays visible for validation failures. Token arrives only in `#t=…`, is read in a client effect, removed with `history.replaceState`, and sent in the POST body — never query, cookies, or storage. Missing/bad link → invalid-link copy + link to forgot-password.
- Pages use theme tokens only; copy lives in `sessionConfig` / env overrides.

## 2. Indigo HQ (`/admin`)

Sidebar title **Hospigo HQ**. Items: Hospitals, Modules and plans, Master data imports, Staff and support, Platform health. Current route is highlighted (`aria-current="page"`). Desktop top bar shows the **page** label (e.g. Hospitals), not a second “Hospigo HQ”. Phones keep the menu button plus sidebar name. Sidebar width uses `--size-sidebar`. Main content scrolls with the document.

- **Hospitals** (built): “Onboard hospital” (disabled), fluid auto-fit stat cards, list of four fake hospitals (including access codes for HQ). Below table breakpoint: stacked cards. From table breakpoint up: table. Module chips use theme foreground for contrast. System health card text lists Database, Redis, Storage, WebSocket.
- Other sidebar items open **Coming later**.
- Sample data badge visible.

## 3. Hospital staff app (`/app`)

Sidebar shows the mock hospital name plus “Powered by Hospigo”. Nav is generated from a mock **enabled modules** list. Current route highlighted; desktop top bar shows page context (e.g. OPD queue). Branch switcher label: **Main Branch (sample)** (static). Main content scrolls with the document.

- **OPD queue** (built): title, fake doctor and speciality, disabled “Call next patient”, fluid auto-fit stats, token table. Status chips use theme colours: In consultation (blue), Checked in paid (green), Booked unpaid at desk (amber).
- Other modules show **Coming later**.
- Brand colour from mock hospital config (CSS variables).
- Sample data badge visible.

## 4. Public booking (`/book/[code]`)

Hospital header band (brand colour via `BrandScope`) with hospital name, “Book an OPD appointment”, and Sample data badge. Soft tint page background; content in a centred white card capped by `--size-content-max`.

- The `[code]` path segment only selects mock data internally. It is never shown to the patient (no access code in the header, summary, labels, or metadata).
- Page and card use **min-height** of the viewport so tall screens keep a full tint/card; content is **top-aligned** with normal section spacing (no stretched gaps between steps). Document scroll when content is taller than the viewport.
- Single column below the layout breakpoint; two columns from that width (doctor/slot left; details + summary right), both top-aligned.
- Touch targets (tiles, slots, inputs, Send OTP) use fluid control tokens.

Steps: (1) choose doctor, (2) choose slot (selection highlighted), (3) name and mobile (empty). **Send OTP** stays disabled until doctor, slot, name, and mobile are all non-empty; it still does nothing real. Phone shows the payment note under the form; two-column layout shows it in the summary.

## Shared behaviour

- Loading, empty, and error-with-retry use the Step 5a shared state components, driven by a small async mock loader.
- Fluid responsive layout from 320px upward with no horizontal overflow. Accessible labels on fields and buttons.
