# Decisions, Step 8c (settings and gaps)

Branch: `feature/step-8c-settings-and-gaps`, from `develop` at `2e333ef` (the merge of 8b, PR #60). One branch, one PR. Decisions by Rakshith, 24 Nov 2026, with the reasons.

## Decisions

1. **Order of 8c versus Step 9.** 8c now comes BEFORE Step 9 (it was "after Step 9" in the tracker, the handoff and decisions-8b). _Why:_ 8b finished early, the items are gaps a real hospital meets on day one, and Step 9 ends with a full test of everything, which should include them.
2. **All ten items in one go**, in this order, one commit group per item so what is finished is always shippable: (4) doctor fee structure, (6) queue doctor filter, (2) payment modes, (3) vitals fields, (1) number series, (7) patient reference field set, (5) voided token marker, (9) doctor leave requests with approval, (8) per-branch print templates, (10) extra print values.
3. **Cut rule.** If time runs short, stop at a clean commit boundary (never in the middle of an item), finish docs and tests for what is built, put the rest on a separate local branch and say so in the report.
4. **NOT built in 8c:** cancelling visits that are not WAITING (it changes money and refund rules, so the manager must decide), part payment, the pending dues list, the Emergency flag, online booking.
5. **One PR for all of 8c.** Migrations are named after `20261127090000`, one per concern, applied ONLY to `hospigo_test`; Rakshith migrates the dev database. Money rules, append-only guarantees and tenant isolation are never weakened.

## Item decisions given with the order

- (4) Option A, no migration: the follow-up fee falls back to the new-visit fee when no FOLLOW_UP row exists; existing follow-up rows stay as overrides; the way back from an override is typing the same amount (it then no longer follows the base). Screen text says so.
- (2) "Requires reference" is ENFORCED at payment (UPI and Card must carry a reference, cash does not). This changes money collection and is a review gate.
- (1) Safe version: prefix, separator, width and financial-year style are editable; the reset rule and the financial-year start month are locked once any number exists; the start number is raise-only with a reason; a database trigger refuses a counter going down.
- (7) Built on the existing custom fields, no new table.
- (5) Marker only, no change to what can be cancelled.
- (9) Answers to the plan questions: Branch Admin (own branches) and SuperAdmin approve; an approved leave cannot be cancelled by the doctor (an Admin removes it in Availability); no free text (a fixed list of reasons or none); no email.
- (8) Lookup order branch, hospital, built-in default; a Branch Admin manages only their own branch; hospital-wide templates stay SuperAdmin-only.
- (10) The smallest safe version of "extra print values" (see its section below).

## Notes added while building

(See the sections below as each item is finished.)
