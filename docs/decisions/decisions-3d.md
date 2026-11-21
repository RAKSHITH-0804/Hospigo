# Hospigo Phase 2, Step 3d: SuperAdmin branch switcher (decisions)

Written 18 Nov 2026 (branch `feature/phase2-step-3d-branch-switcher`). Read with `docs/reference/api-auth.md` (branch switcher sections).

## Decisions

- Only a user with an **active hospital-wide (scope HOSPITAL) assignment on an active role** may switch. Checked in the service from the database on every call, never from the token. Rule is scope-based, not role-code-based: when Step 7b lets a hospital assign scopes, restate this rule there.
- A switch is a **refresh-token rotation that also changes the branch** (same session family, new session on the target branch). Replaying the old token is reuse: the family is revoked. The old access token cannot be revoked (stateless); it stays valid for its remaining life, only for the previous branch.
- `refreshHospital` accepts a session on a branch when the user has an active membership **or** an active hospital-wide assignment, re-checked on every refresh. Losing both revokes the family.
- Rotation (`/auth/refresh` and `/auth/switch-branch`) takes the session with one atomic update; of several simultaneous rotations exactly one wins, the others count as reuse (family revoked). Accepted by Rakshith: two tabs refreshing at the same instant can log the user out.
- Another hospital's branch, an unknown id and an inactive branch all return the same 404. Refused attempts are audited with a reason code only.
- No migration.
- Web: the switch goes through a route handler using the same single-flight as silent renewal; a **stale-tab guard** (`x-hospigo-branch` header on every write, 409 `BRANCH_CHANGED`) and a **focus re-check** (reload when the shared cookie holds another branch) protect against two tabs on one cookie.

## Follow-ups (noticed, not fixed)

- Single-flight is per web process; several web servers need a shared grace window (existing follow-up).
- A switch request carrying an already-spent cookie while the previous refresh response is still in transit can theoretically finish before that response lands; very narrow, not seen in tests.
- The focus reload discards unsaved form input (the guard alone would keep it). Consider a "reload" banner for dirty forms if staff complain.
- Each switch costs two API calls inside the login/refresh IP limit (renewal + switch).
- No per-user rate limit on switch attempts (IP limit only); refused attempts write one audit row each.
- A user flagged `mustChangePassword` after login is not specially handled on switch (same as refresh).
