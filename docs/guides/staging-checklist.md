# Staging checklist

Use before first live or staging promote. Names only — fill values in the environment, never in git.

## Proxy and client IP

- Web: `WEB_TRUST_FORWARDED_HEADERS=true` only behind our own IIS/nginx.
- API: `AUTH_TRUSTED_PROXY` set to the real hop count (not `none`) so Express trusts the same path.
- Pair them: trusting forwarded headers on one side only breaks rate limits or allows spoofing.
- **Go-live (patient OTP):** set both correctly. If the API sees only the web server's IP, every patient shares one per-IP OTP limit.
- API must listen on a **private** interface (not public 0.0.0.0 without a proxy).

## URLs per environment

- `APP_URL` = exact browser origin users type (cookies + email links).
- `API_INTERNAL_URL` = server-only Next → API base (never `NEXT_PUBLIC_*`).
- `API_URL` / `STAGING_URL` = documentation / ops only.

## Mail

- Replace Mailpit with real SMTP (`SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM`; auth as needed).
- Configure SPF and DKIM for the sending domain before inviting hospitals.
- `SMTP_SECURE` as required by the provider.

## JWT

- Distinct `JWT_HOSPITAL_ACCESS_SECRET` and `JWT_HQ_ACCESS_SECRET` per environment (≥32 chars each).
- Never reuse CI or local secrets in staging/production.

## First-live seed rules

- Reference seed only (modules, permissions, catalog) outside development.
- Dev tenant seed **refuses** unless `NODE_ENV=development`.
- Production API **refuses to start** if any hospital has `isTest=true`.
- Do not run `SEED_*` passwords in production env files.

## Swagger

- Off when `NODE_ENV=production` (no `/docs`).

## Backups

- FTP / off-box backups: **not built** — track before go-live.

## WebSocket

- Socket.IO present; **WebSocket auth not wired** — do not expose clinical realtime until AuthGuard covers it.

## Domain layout

- Public app: `hospigo.indigocomputers.in` (and staging host as needed).
- API behind private network or reverse proxy only.

## Windows vs Linux

- Local Windows + Memurai/Redis and Mailpit are fine for development.
- Staging/production target Linux containers or VMs; paths for `STORAGE_ROOT_PATH` must be absolute and writable.

## Storage

- Local-folder `STORAGE_ROOT_PATH` today; S3-compatible driver is a later product decision — confirm before multi-node staging.
