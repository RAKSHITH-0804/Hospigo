# Auth API (Step 6a-2)

Staff/HQ password auth. No email, OTP, or patient login here.

Client IP comes from Express. `AUTH_TRUSTED_PROXY` defaults to `none` so `X-Forwarded-For` is **not** trusted. Set a hop count (or `true`) only behind a known reverse proxy.

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
