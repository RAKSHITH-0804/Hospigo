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
| [H] Hospigo        [|=]  | [pin Branch…]   [Search patients /] [User]|
| Hospital name (ellipsis + tooltip)                                  |
| Nav icons + labels…      |              #main-content               |
| …Settings (if allowed)   |                                          |
| Powered by Indigo        |                                          |
+--------------------------+------------------------------------------+
```

Collapsed (40px mark, then collapse control; hospital name not shown visually):

```
+------+------------------------------------------+
| [H]  | [pin Branch…]   [Search…]          [User]|
| [|=] |                                          |
| [ic] |              #main-content               |
| [ic] |                                          |
| logo |                                          |
+------+------------------------------------------+
```

- **Brand row:** `--sidebar-mark-size` mark + full “Hospigo” wordmark (`whitespace-nowrap`, no ellipsis, `flex-shrink: 0`) + collapse, vertically centered. Only the hospital-name row ellipsizes.
- **Collapse:** `PanelLeft` ghost button, 44px, tooltip + Kbd (`Ctrl`/`Cmd`+`B`). Shortcut ignored in inputs. `aria-expanded` + `aria-controls`.
- **Expanded hospital name:** own row under brand/wordmark/collapse; full text in DOM; CSS ellipsis; Tooltip on hover/focus (`tabIndex={0}`).
- **Collapsed nav:** 44×44 icon buttons, custom tooltip (`role="tooltip"`, `aria-describedby`) on hover/focus; Escape dismisses. Nav body scrolls; header/footer stay put.
- **Settings:** last main-nav item when `hospital.settings.read` (not a separate footer block).
- **Footer:** `PoweredBy` from `apps/web/src/config/branding.ts`. When `indigoLogo` is null → muted “Powered by Indigo” text (hidden when collapsed). When set → image (`public/brand/` white-on-dark SVG).
- **Skip link:** first focusable control → `#main-content`.
- **Branch chip:** read-only for every hospital user (map-pin + ellipsis). Not a control.

**Branch switcher (Step 3d):** visible only to users whose role has hospital-wide scope (SuperAdmin). Branch Admin and other staff work in the branch of the access code they logged in with; for them the branch chip stays a read-only label. Switching will issue a new access token for the chosen branch (server-side permission check, audit entry, tests).

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
