-- Platform patient accounts + OTP challenges + refresh sessions (global; no tenant_id / no RLS).
-- Protected by DB role grants: hospigo_patient only (SIU). Role is created by scripts/db/create-roles.mjs.

CREATE TYPE "patient_account_status" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "patient_otp_purpose" AS ENUM ('LOGIN', 'BOOKING');
CREATE TYPE "patient_otp_channel" AS ENUM ('WHATSAPP', 'SMS');

CREATE TABLE "patient_accounts" (
  "id" TEXT NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "status" "patient_account_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "last_login_at" TIMESTAMPTZ(3),
  CONSTRAINT "patient_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_accounts_phone_e164_key" ON "patient_accounts"("phone_e164");

CREATE TABLE "patient_otp_challenges" (
  "id" TEXT NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "purpose" "patient_otp_purpose" NOT NULL,
  "code_hmac" TEXT NOT NULL,
  "channel" "patient_otp_channel" NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMPTZ(3),
  "resend_available_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_otp_challenges_phone_e164_created_at_idx"
  ON "patient_otp_challenges"("phone_e164", "created_at");

CREATE TABLE "patient_auth_sessions" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "replaced_by_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "ip" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "patient_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_auth_sessions_token_hash_idx" ON "patient_auth_sessions"("token_hash");
CREATE INDEX "patient_auth_sessions_family_id_idx" ON "patient_auth_sessions"("family_id");
CREATE INDEX "patient_auth_sessions_account_id_idx" ON "patient_auth_sessions"("account_id");

ALTER TABLE "patient_auth_sessions"
  ADD CONSTRAINT "patient_auth_sessions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "patient_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_auth_sessions"
  ADD CONSTRAINT "patient_auth_sessions_replaced_by_id_fkey"
  FOREIGN KEY ("replaced_by_id") REFERENCES "patient_auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Owner retains full access for migrate/seed/fixtures.
GRANT ALL ON TABLE "patient_accounts", "patient_otp_challenges", "patient_auth_sessions" TO hospigo_owner;

-- Patient role: SELECT/INSERT/UPDATE only (no DELETE).
GRANT SELECT, INSERT, UPDATE ON TABLE "patient_accounts", "patient_otp_challenges", "patient_auth_sessions" TO hospigo_patient;

-- Deny app, HQ, and PUBLIC.
REVOKE ALL ON TABLE "patient_accounts", "patient_otp_challenges", "patient_auth_sessions" FROM hospigo_app;
REVOKE ALL ON TABLE "patient_accounts", "patient_otp_challenges", "patient_auth_sessions" FROM hospigo_hq;
REVOKE ALL ON TABLE "patient_accounts", "patient_otp_challenges", "patient_auth_sessions" FROM PUBLIC;
