-- Refresh-token session tables (hashed secrets only). Plain cuid ids; server timestamps.

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "replaced_by_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "ip" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_tenant_id_id_key" ON "auth_sessions"("tenant_id", "id");
CREATE INDEX "auth_sessions_tenant_id_token_hash_idx" ON "auth_sessions"("tenant_id", "token_hash");
CREATE INDEX "auth_sessions_tenant_id_family_id_idx" ON "auth_sessions"("tenant_id", "family_id");
CREATE INDEX "auth_sessions_tenant_id_user_id_idx" ON "auth_sessions"("tenant_id", "user_id");

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_tenant_id_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_tenant_id_replaced_by_id_fkey"
  FOREIGN KEY ("tenant_id", "replaced_by_id") REFERENCES "auth_sessions"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "hq_auth_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "replaced_by_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "ip" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "hq_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hq_auth_sessions_token_hash_idx" ON "hq_auth_sessions"("token_hash");
CREATE INDEX "hq_auth_sessions_family_id_idx" ON "hq_auth_sessions"("family_id");
CREATE INDEX "hq_auth_sessions_user_id_idx" ON "hq_auth_sessions"("user_id");

ALTER TABLE "hq_auth_sessions"
  ADD CONSTRAINT "hq_auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "hq_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hq_auth_sessions"
  ADD CONSTRAINT "hq_auth_sessions_replaced_by_id_fkey"
  FOREIGN KEY ("replaced_by_id") REFERENCES "hq_auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: tenant sessions
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_sessions_app_all ON auth_sessions
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- hq_auth_sessions: no tenant RLS; role grants only (FORCE not required for global table pattern).
-- Keep FORCE off; table is global like hq_users.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_sessions TO hospigo_app;
GRANT ALL ON TABLE auth_sessions TO hospigo_owner;

-- HQ may manage HQ users and HQ sessions only (widening from previous: no hq_users grants).
GRANT SELECT, INSERT, UPDATE ON TABLE hq_users TO hospigo_hq;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE hq_auth_sessions TO hospigo_hq;
GRANT ALL ON TABLE hq_users, hq_auth_sessions TO hospigo_owner;

-- App must not touch HQ session storage.
REVOKE ALL ON TABLE hq_auth_sessions FROM hospigo_app;
REVOKE ALL ON TABLE hq_users FROM hospigo_app;
