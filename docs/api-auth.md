# Auth API (Step 6a-2) and web session (Step 6d)

Staff/HQ password auth. No email, OTP, or patient login here.

## Web browser flow (Step 6d)

The browser talks **only** to the Next.js app. Route handlers under `apps/web/src/app/api/auth/` call the API server-to-server using **`API_INTERNAL_URL`** (server-only; never `NEXT_PUBLIC_*`). Tokens stay in **httpOnly** cookies — never in browser JavaScript or storage. The API does not need CORS for the web app.

| Cookie (name from `apps/web/src/config/session.ts`)                  | httpOnly | Path             | maxAge                                                                    |
| -------------------------------------------------------------------- | -------- | ---------------- | ------------------------------------------------------------------------- |
| Access (`WEB_COOKIE_ACCESS_NAME`, default `hospigo_access`)          | yes      | `/`              | API `expiresIn`                                                           |
| Refresh (`WEB_COOKIE_REFRESH_NAME`, default `hospigo_refresh`)       | yes      | `/api/auth` only | `WEB_REFRESH_COOKIE_MAX_AGE_SEC` (default 7d)                             |
| Change-password (`WEB_COOKIE_CHANGE_NAME`, default `hospigo_change`) | yes      | `/`              | min(API expiresIn, `WEB_CHANGE_PASSWORD_COOKIE_MAX_AGE_SEC`, default 10m) |

`Secure` when `NODE_ENV=production` or `APP_URL` is https; `SameSite=Lax`.

**Client IP / proxy:** Web BFF forwards a chosen client IP to the API as `X-Forwarded-For`.

- `WEB_TRUST_FORWARDED_HEADERS` (web, default `false`): when false, `resolveClientIp` uses **only** the TCP socket address and **ignores** incoming `x-forwarded-for` / `x-real-ip` (safe for local/dev and direct exposure). When true (web sits behind our own IIS or nginx), it prefers `x-forwarded-for`, then `x-real-ip`, then socket.
- `AUTH_TRUSTED_PROXY` (API, default `none`): Express trust setting. With `none` the API **ignores** `X-Forwarded-For` (typical local/dev).

Production behind a reverse proxy needs **both**: set `WEB_TRUST_FORWARDED_HEADERS=true` on the web app **and** set the API’s `AUTH_TRUSTED_PROXY` to match the real hop count (or `true` only behind a known proxy). Otherwise spoofed headers are trusted on one side, or every user shares the proxy IP for rate limits on the other. The API must listen only on a private interface in that setup.

Put `API_INTERNAL_URL` and `APP_URL` in `apps/web/.env.local` (gitignored).

**`APP_URL`:** must equal the public origin users type in the browser. Absolute BFF redirects (refresh success/failure) use `APP_URL`, not `request.url` / Host from a mismatched alias. Open the web app at exactly `APP_URL` in development — `http://127.0.0.1:3001` and `http://localhost:3001` are different cookie hosts.

## Endpoints

| Method | Path                    | Auth                                              | Body                                                                                                                                                                                   |
| ------ | ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/hospital/login`  | public                                            | `accessCode`, `email`, `password`                                                                                                                                                      |
| POST   | `/auth/hq/login`        | public                                            | `email`, `password`                                                                                                                                                                    |
| POST   | `/auth/refresh`         | public                                            | `refreshToken`                                                                                                                                                                         |
| POST   | `/auth/logout`          | public                                            | `refreshToken` (idempotent)                                                                                                                                                            |
| POST   | `/auth/change-password` | Bearer (`HOSPITAL`, `HQ`, or `CHANGE_PASSWORD_*`) | `currentPassword`, `newPassword` (wrong current password → generic 401; per-user lockout under `hospigo:auth:cpw:` with the same failure/lock windows as login; IP rate limit applies) |
| GET    | `/auth/me`              | Bearer (`HOSPITAL` or `HQ`)                       | —                                                                                                                                                                                      |

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

### GET `/auth/me`

Returns only: `id`, `displayName`, `email`, `kind` (`HOSPITAL` \| `HQ`), `hospitalName`, `activeBranchId`, `activeBranchName`, `roleCodes`, `mustChangePassword`. Never password hashes, tokens, or other tenants’ data.

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
