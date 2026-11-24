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
