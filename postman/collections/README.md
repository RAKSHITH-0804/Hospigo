# Postman collections

One collection per step (3d to 8c). Import a collection and press **Run collection**. Every request
has checks; a green run is the proof for the step.

**No secrets in here.** Passwords, tokens and keys are never stored in a collection: every login uses
a `{{variable}}`. The environment file (with the demo passwords from `.env` and `dev-accounts.md`) is
**never committed** (`*.postman_environment.json` is git-ignored). Keep it on your own PC.

Variables each collection needs in your environment (names only):

- `baseUrl` (the API, for example `http://127.0.0.1:3000`)
- the passwords of the demo logins the collection uses, for example `receptionPassword`,
  `superPassword`, `nursePassword`, `doctorPassword`, `branchAdminPassword`, `southPassword`
  (open the collection, tab Variables, to see which ones it reads)

Run order and what to click first: `docs/guides/manual-regression-checklist.md`.
Before adding a collection, scan it: no `eyJ` tokens, no `Bearer <literal>`, no password literals.

## Rate limit on login

The login endpoints allow about 20 requests per minute per address, and every collection logs in
several times. Run collections **one at a time**, or wait a minute between them. A `429` on a login
request means this; it is not a bug.

## Notes on shared dev data

- Collection 7 (reports and print templates) removes any leftover receipt template at branch and
  hospital level in its Setup folder, so it runs on a dev database that has been used by hand.
- Collection 7e accepts a hospital that already has a logo (logos cannot be deleted).
- The older "Patients registry v2 (P2 Step 3a)" collection is not in this folder (it was never
  committed); it needs a pasted token and is replaced by the patient checks in 3d and 4a.
