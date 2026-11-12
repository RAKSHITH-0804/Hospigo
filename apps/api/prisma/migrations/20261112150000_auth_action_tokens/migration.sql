-- Activation / password-reset action tokens (hashed secrets only).

CREATE TYPE "auth_action_purpose" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

CREATE TABLE "auth_action_tokens" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "purpose" "auth_action_purpose" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_action_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_action_tokens_tenant_id_id_key" ON "auth_action_tokens"("tenant_id", "id");
CREATE INDEX "auth_action_tokens_tenant_id_user_id_purpose_idx" ON "auth_action_tokens"("tenant_id", "user_id", "purpose");
CREATE INDEX "auth_action_tokens_id_idx" ON "auth_action_tokens"("id");

ALTER TABLE "auth_action_tokens"
  ADD CONSTRAINT "auth_action_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_action_tokens"
  ADD CONSTRAINT "auth_action_tokens_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HQ reset tokens (PASSWORD_RESET only; no tenant).
CREATE TABLE "hq_auth_action_tokens" (
  "id" TEXT NOT NULL,
  "hq_user_id" TEXT NOT NULL,
  "purpose" "auth_action_purpose" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hq_auth_action_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hq_auth_action_tokens_purpose_check" CHECK ("purpose" = 'PASSWORD_RESET')
);

CREATE INDEX "hq_auth_action_tokens_hq_user_id_purpose_idx" ON "hq_auth_action_tokens"("hq_user_id", "purpose");
CREATE INDEX "hq_auth_action_tokens_id_idx" ON "hq_auth_action_tokens"("id");

ALTER TABLE "hq_auth_action_tokens"
  ADD CONSTRAINT "hq_auth_action_tokens_hq_user_id_fkey"
  FOREIGN KEY ("hq_user_id") REFERENCES "hq_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: tenant action tokens
ALTER TABLE "auth_action_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_action_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_action_tokens_app_all ON auth_action_tokens
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON TABLE auth_action_tokens TO hospigo_app;
GRANT ALL ON TABLE auth_action_tokens TO hospigo_owner;

-- HQ action tokens: no tenant RLS; HQ role only.
GRANT SELECT, INSERT, UPDATE ON TABLE hq_auth_action_tokens TO hospigo_hq;
GRANT ALL ON TABLE hq_auth_action_tokens TO hospigo_owner;

REVOKE ALL ON TABLE hq_auth_action_tokens FROM hospigo_app;
REVOKE ALL ON TABLE auth_action_tokens FROM hospigo_hq;
