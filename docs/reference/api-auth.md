# Auth API (Step 6a-2 / 6b email flows) and web session (Step 6d)

Staff/HQ password auth plus activation and password-reset email links (Step 6b part A). No OTP or patient login here.

## Web browser flow (Step 6d)

The browser talks **only** to the Next.js app. Route handlers under `apps/web/src/app/api/auth/` call the API server-to-server using **`API_INTERNAL_URL`** (server-only; never `NEXT_PUBLIC_*`). Tokens stay in **httpOnly** cookies — never in browser JavaScript or storage. The API does not need CORS for the web app.

| Cookie (name from `apps/web/src/config/session.ts`)                                    | httpOnly | Path                     | maxAge                                                                    |
| -------------------------------------------------------------------------------------- | -------- | ------------------------ | ------------------------------------------------------------------------- |
| Access (`WEB_COOKIE_ACCESS_NAME`, default `hospigo_access`)                            | yes      | `/`                      | API `expiresIn`                                                           |
| Refresh (`WEB_COOKIE_REFRESH_NAME`, default `hospigo_refresh`)                         | yes      | `/api/auth` only         | `WEB_REFRESH_COOKIE_MAX_AGE_SEC` (default 7d)                             |
| Change-password (`WEB_COOKIE_CHANGE_NAME`, default `hospigo_change`)                   | yes      | `/`                      | min(API expiresIn, `WEB_CHANGE_PASSWORD_COOKIE_MAX_AGE_SEC`, default 10m) |
| Patient access (`WEB_PATIENT_COOKIE_ACCESS_NAME`, default `hospigo_patient_access`)    | yes      | `/`                      | API `expiresIn`                                                           |
| Patient refresh (`WEB_PATIENT_COOKIE_REFRESH_NAME`, default `hospigo_patient_refresh`) | yes      | `/api/patient-auth` only | `WEB_PATIENT_REFRESH_COOKIE_MAX_AGE_SEC` (default 30d)                    |

Patient and staff refresh paths must not equal or prefix-overlap (enforced in `loadSessionConfig`).

`Secure` when `NODE_ENV=production` or `APP_URL` is https; `SameSite=Lax`.

**Client IP / proxy:** Web BFF forwards a chosen client IP to the API as `X-Forwarded-For`.

- `WEB_TRUST_FORWARDED_HEADERS` (web, default `false`): when false, `resolveClientIp` uses **only** the TCP socket address and **ignores** incoming `x-forwarded-for` / `x-real-ip` (safe for local/dev and direct exposure). When true (web sits behind our own IIS or nginx), it prefers `x-forwarded-for`, then `x-real-ip`, then socket.
- `AUTH_TRUSTED_PROXY` (API, default `none`): Express trust setting. With `none` the API **ignores** `X-Forwarded-For` (typical local/dev).

Production behind a reverse proxy needs **both**: set `WEB_TRUST_FORWARDED_HEADERS=true` on the web app **and** set the API’s `AUTH_TRUSTED_PROXY` to match the real hop count (or `true` only behind a known proxy). Otherwise spoofed headers are trusted on one side, or every user shares the proxy IP for rate limits on the other. The API must listen only on a private interface in that setup.

Put `API_INTERNAL_URL` and `APP_URL` in `apps/web/.env.local` (gitignored).

**`APP_URL`:** must equal the public origin users type in the browser. Absolute BFF redirects (refresh success/failure) use `APP_URL`, not `request.url` / Host from a mismatched alias. Open the web app at exactly `APP_URL` in development — `http://127.0.0.1:3001` and `http://localhost:3001` are different cookie hosts.

## Endpoints

| Method | Path                        | Auth                                              | Body                                                                                                                                                                                   |
| ------ | --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/hospital/login`      | public                                            | `accessCode`, `email`, `password`                                                                                                                                                      |
| POST   | `/auth/hq/login`            | public                                            | `email`, `password`                                                                                                                                                                    |
| POST   | `/auth/refresh`             | public                                            | `refreshToken`                                                                                                                                                                         |
| POST   | `/auth/logout`              | public                                            | `refreshToken` (idempotent)                                                                                                                                                            |
| POST   | `/auth/change-password`     | Bearer (`HOSPITAL`, `HQ`, or `CHANGE_PASSWORD_*`) | `currentPassword`, `newPassword` (wrong current password → generic 401; per-user lockout under `hospigo:auth:cpw:` with the same failure/lock windows as login; IP rate limit applies) |
| GET    | `/auth/me`                  | Bearer (`HOSPITAL` or `HQ`)                       | —                                                                                                                                                                                      |
| GET    | `/auth/switchable-branches` | Bearer (`HOSPITAL`, hospital-wide role only)      | — (others get 403)                                                                                                                                                                     |
| POST   | `/auth/switch-branch`       | Bearer (`HOSPITAL`, hospital-wide role only)      | `branchId`, `refreshToken` → new `accessToken` + rotated `refreshToken` for the target branch                                                                                          |
| POST   | `/auth/forgot-password`     | public                                            | `accessCode`, `email` → always **202** `{ accepted: true }` (padded timing; enqueue only for active user+membership)                                                                   |
| POST   | `/auth/hq/forgot-password`  | public                                            | `email` → always **202** `{ accepted: true }`                                                                                                                                          |
| POST   | `/auth/reset-password`      | public                                            | `token`, `newPassword` → **204**; hospital `h.` or HQ `q.` tokens                                                                                                                      |
| POST   | `/auth/activate`            | public                                            | `token`, `newPassword` → **204**; hospital activation only                                                                                                                             |

### Email action tokens (Step 6b)

- Hospital: `h.<tenantId>.<tokenId>.<secret>` — purposes `ACTIVATION` \| `PASSWORD_RESET`.
- HQ: `q.<tokenId>.<secret>` — `PASSWORD_RESET` only.
- Store **SHA-256 of secret only**; verify with the same constant-time helper as refresh secrets.
- Links: `${APP_URL}/activate#t=<token>` and `${APP_URL}/reset-password#t=<token>` (secret after `#` only). Never email a password.
- Mail queue job data is only `{ kind, tenantId|null, userId }` — Redis never holds tokens or emails.
- Creating a token invalidates earlier unused tokens of the same purpose for that user.
- Consume is atomic (`UPDATE … SET used_at … WHERE used_at IS NULL AND expires_at > now RETURNING`) in the same transaction as the password change.
- Invalid / expired / used / wrong-secret tokens share one body: `400 {"statusCode":400,"message":"Invalid or expired link","error":"Bad Request"}`.
- Weak passwords return the existing `Password rejected: …` 400 **without** consuming the token.
- Rate limits: per-IP (`AUTH_IP_RATE_LIMIT_*`) on forgot/reset/activate; per-account hash under `hospigo:auth:reset:req:` (`AUTH_RESET_MAX_REQUESTS_PER_WINDOW` / `AUTH_RESET_REQUEST_WINDOW_MS`). Redis down → 503.

### Mailpit (local SMTP)

- SMTP: `127.0.0.1:1025` (`SMTP_USER` / `SMTP_PASSWORD` may be empty; `SMTP_SECURE=false`).
- Inbox UI: `http://127.0.0.1:8025`.
- Set `APP_URL` to the web origin used in the browser (e.g. `http://127.0.0.1:3001`).

### Web BFF + pages (Step 6b part B)

Browser never talks to the API with tokens in query strings. Pages:

| Page               | Role                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `/forgot-password` | Hospital (access code + email) or HQ (`?tab=hq`) → BFF → always neutral confirmation on 202 |
| `/reset-password`  | Reads `#t=…` in the client, strips the hash, POSTs token in JSON body                       |
| `/activate`        | Same token handling as reset                                                                |
| `/login`           | “Forgot password?” link; optional `?notice=password-updated` banner (no secrets)            |

BFF routes under `/api/auth/`:

| BFF                                 | Upstream                   | Browser success       | Notable errors                                                               |
| ----------------------------------- | -------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `POST /api/auth/forgot-password`    | `/auth/forgot-password`    | 202 `{accepted:true}` | 429 `RATE_LIMITED`; 503 `UNAVAILABLE`; other 4xx masked as 202               |
| `POST /api/auth/hq-forgot-password` | `/auth/hq/forgot-password` | same                  | same                                                                         |
| `POST /api/auth/reset-password`     | `/auth/reset-password`     | 204                   | 400 `INVALID_LINK` (generic link message); 400 `VALIDATION` (password rules) |
| `POST /api/auth/activate`           | `/auth/activate`           | 204                   | same as reset                                                                |

### Web BFF: branch switcher (Step 3d)

| BFF                            | Upstream                                   | Notes                                                                                                                                                                |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/switch-branch` | `/auth/refresh` then `/auth/switch-branch` | Body `{ branchId }` only. Origin + JSON checks. Reads the refresh cookie (path `/api/auth`), sets both new cookies, returns `{ ok: true }`. No token in the body.    |
| `GET /api/auth/active-branch`  | none (reads the access cookie)             | `{ activeBranchId }` or `null`. Used by a tab that regains focus; the page reloads only if the id differs from the one it was rendered for. Never reloads on `null`. |
| `GET /api/staff/branches`      | `/auth/switchable-branches`                | Branch list for the dropdown (403 for users who may not switch).                                                                                                     |

Errors (JSON `{ ok: false, code }`): `FORBIDDEN` 403, `BRANCH_NOT_AVAILABLE` 404, `SAME_BRANCH` 400, `VALIDATION` 400, `SWITCH_IN_PROGRESS` 409, `SESSION_EXPIRED` 401 (cookies cleared), `RATE_LIMITED` 429, `UNAVAILABLE` 502/503, `UNKNOWN` 500. A refused switch still returns the rotated cookies (the renewal step already spent the old refresh token).

**Single-flight:** the switch route uses the same in-process single-flight as `/api/auth/refresh-session` (`lib/auth/refresh-flight.ts`), keyed by the refresh token. A refresh and a switch on one cookie can never both present the same token to the API: a refresh joins a running switch and ends with its tokens; a switch that arrives during a refresh waits and continues from the rotated tokens; two switches to different branches at once: the second gets 409. Limit: the table is per web process (see the existing follow-up about several web servers).

**Stale-tab guard:** every browser write (POST/PUT/PATCH/DELETE through `staffRoute`) must carry `x-hospigo-branch` with the branch the page was rendered for. If it differs from the branch in the session cookie, or is missing, the route answers `409 { code: "BRANCH_CHANGED" }` and nothing reaches the API. A route that forgets to pass `request` to `staffRoute` is refused too (fail closed). The API remains the only authority; this only stops a write landing in a different branch than the one on screen.

Security headers on `/forgot-password`, `/reset-password`, `/activate`: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

### Token response

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque>",
  "expiresIn": 900,
  "mustChangePassword": false
}
```

When `mustChangePassword` is true (forced change), login returns only `accessToken` + `expiresIn` + `mustChangePassword: true` (a short-lived `CHANGE_PASSWORD_*` token; no refresh token).

## Patient OTP login (Step 6c)

Platform-level patient accounts (phone + OTP). Separate JWT secret and DB role (`hospigo_patient`). Not linked to hospital patient records yet. Dev message driver only (`OTP_DRIVER=dev`).

| Method | Path                        | Auth             | Body                                                                                   |
| ------ | --------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| POST   | `/patient/auth/request-otp` | public           | `phone` → always `{ ok: true, resendAfterSec }`                                        |
| POST   | `/patient/auth/verify-otp`  | public           | `phone`, `code` → `{ accessToken, refreshToken, expiresIn }` (no `mustChangePassword`) |
| POST   | `/patient/auth/refresh`     | public           | `refreshToken` → same shape                                                            |
| POST   | `/patient/auth/logout`      | public           | `refreshToken` (idempotent; revokes whole family)                                      |
| GET    | `/patient/me`               | Bearer `PATIENT` | → `{ id, phone (masked), createdAt, linkedProfiles: [] }`                              |

Phone normalized to E.164 (`+91…`). OTP stored as HMAC only. Refresh format `p.<sessionId>.<secret>`. Patient tokens are refused on staff/HQ routes and the reverse.

**Web patient BFF (Step 6e):** browser uses `/api/patient-auth/request-otp`, `verify-otp` (sets cookies; JSON `{ ok: true }` only), `GET refresh` (sanitized `next` under `/patient`), `POST logout`. Pages: `/patient/login`, `/patient`.

### Branch switcher (Step 3d)

Only a user with an **active hospital-wide (scope `HOSPITAL`) assignment on an active role** may switch; this is re-read from the database on every call, never from the token. Everyone else gets 403 and works in the branch of their access code.

- `POST /auth/switch-branch` is a **refresh-token rotation that also changes the branch**: the presented session is revoked and a new session in the **same family** for the target branch replaces it, so reuse detection is unchanged (replaying the old token revokes the family). The presented refresh token must belong to the caller (same user and hospital).
- The rotation takes the session with one atomic update; of several simultaneous rotations (switch or refresh) exactly one wins, the others are treated as reuse (401, family revoked). `/auth/refresh` uses the same atomic step.
- Target checks: same hospital (row level security) and active. Another hospital's branch, an unknown id and an inactive branch all return the same `404 {"message":"Branch not available"}`. The branch already active returns 400.
- Refresh rule change: a session is accepted when the user has an active branch membership **or** an active hospital-wide assignment (same rule as `AccessService`), checked on every refresh. Losing both revokes the family.
- The previous access token cannot be revoked (stateless, no session id). It stays valid until it expires, only for the previous branch.
- Audit: `AUTH_BRANCH_SWITCH` (metadata `fromBranchId`, `toBranchId`, `sessionId`, `requestId`), `AUTH_BRANCH_SWITCH_DENIED` (metadata `reason` code only), `AUTH_REFRESH_REUSE` on replay. No personal values, no supplied ids from refused attempts.
- Same IP rate limit and fail-closed Redis behaviour as `/auth/refresh` (429 / 503).

### GET `/auth/me`

Returns: `id`, `displayName`, `email`, `kind` (`HOSPITAL` \| `HQ`), `hospitalName`, `activeBranchId`, `activeBranchName`, `roleCodes`, `mustChangePassword`, plus:

| Field             | HOSPITAL                                                                                                                                        | HQ      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `branches`        | Assigned active branches: `{ id, name, isMain }[]`                                                                                              | `[]`    |
| `enabledModules`  | Modules enabled for the **active branch** (hospital subscription **and** branch_modules flags, same rules as AccessService): `{ code, name }[]` | `[]`    |
| `permissions`     | Permission codes allowed on the **active branch** (same snapshot as `AccessService.can` without a module gate); sorted, unique                  | `[]`    |
| `canSwitchBranch` | `true` when the user holds an active hospital-wide role (branch switcher); the active branch name is read directly, not only from memberships   | `false` |

Tenant ids and module lists come from the access token context — never from client-supplied ids. Never password hashes, tokens, or other tenants’ data.

**Web shell (Step 7 / 3b):** hospital `/app` layout reads this profile for hospital title, active branch, sidebar items via `apps/web/src/config/modules.ts`, and `permissions` (Patients nav + `requirePermission`). Module routes use `requireModule` → `/app?notice=module-unavailable`; permission routes → `/app?notice=no-permission`.

## Errors

| Status | When                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401    | Generic auth failure (unknown code, inactive branch/hospital, bad credentials, disabled user, no membership, lockout, wrong current password on change-password, bad/reused/expired refresh, inactive membership on refresh). Same JSON body every time. |
| 429    | IP rate limit exceeded on login, refresh, or change-password; `Retry-After` set.                                                                                                                                                                         |
| 503    | Redis unavailable (fail-closed on login/refresh/change-password).                                                                                                                                                                                        |
| 400    | Validation (unknown fields, bad types).                                                                                                                                                                                                                  |
| 413    | Body over `AUTH_REQUEST_BODY_LIMIT_BYTES`.                                                                                                                                                                                                               |

### Web BFF error mapping (`apps/web` `/api/auth/*`)

| Web status | `code`                | When                                                                                           |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| 400        | `VALIDATION`          | Upstream 400 (password rules); optional safe `message` only for known password-rule strings    |
| 401        | `INVALID_CREDENTIALS` | Upstream 401                                                                                   |
| 403        | `FORBIDDEN`           | Upstream 403                                                                                   |
| 429        | `RATE_LIMITED`        | Upstream 429 (`Retry-After` forwarded when present)                                            |
| 502 / 503  | `UNAVAILABLE`         | Bad/empty 2xx upstream body (502) or network/Redis-style 503                                   |
| 500        | `UNKNOWN`             | Unexpected upstream status (logged server-side without bodies/tokens/passwords/emails/cookies) |

## Example curls (placeholders only)

```bash
curl -sS -X POST "$API_URL/auth/hospital/login" \
  -H 'Content-Type: application/json' \
  -d '{"accessCode":"demo-north-main","email":"staff@demo-north.example.test","password":"<password>"}'

curl -sS -X POST "$API_URL/auth/hq/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<hq@example.test>","password":"<password>"}'

curl -sS -X POST "$API_URL/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh-token>"}'

curl -sS -X POST "$API_URL/auth/logout" \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh-token>"}'

curl -sS -X POST "$API_URL/auth/change-password" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access-or-change-password-token>' \
  -d '{"currentPassword":"<current>","newPassword":"<new-password>"}'

curl -sS "$API_URL/auth/me" \
  -H 'Authorization: Bearer <access-token>'
```

## Limits (all from `auth.config.ts` / env)

- IP: `AUTH_IP_RATE_LIMIT_PER_MIN` (default 20) per `AUTH_IP_RATE_LIMIT_WINDOW_MS` (default 60000).
- Lockout: `AUTH_LOGIN_MAX_FAILURES` (5) within `AUTH_LOGIN_FAILURE_WINDOW_MS` (15m) locks for `AUTH_LOGIN_LOCKOUT_MS` (15m). Login keys hash code+email; change-password keys hash `tenantId|userId` (or `hq|userId`) under `hospigo:auth:cpw:`; never store raw email.
- Change-password token TTL: `AUTH_CHANGE_PASSWORD_TOKEN_TTL_SEC` (default 600).
- Body size: `AUTH_REQUEST_BODY_LIMIT_BYTES` (default 102400).
