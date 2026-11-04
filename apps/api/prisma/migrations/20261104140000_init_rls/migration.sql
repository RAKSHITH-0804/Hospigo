-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "hospital_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "role_scope_type" AS ENUM ('HOSPITAL', 'BRANCH');

-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hq_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hq_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_code" TEXT NOT NULL,
    "status" "hospital_status" NOT NULL DEFAULT 'ACTIVE',
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospital_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hospital_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospital_module_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hospital_module_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_modules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "enabled_by_indigo" BOOLEAN NOT NULL DEFAULT true,
    "restricted_by_hospital" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "scope_type" "role_scope_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment_branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_assignment_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "branch_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modules_code_key" ON "modules"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hq_users_email_key" ON "hq_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_code_key" ON "hospitals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_access_code_key" ON "hospitals"("access_code");

-- CreateIndex
CREATE INDEX "hospital_settings_tenant_id_key_idx" ON "hospital_settings"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "hospital_settings_tenant_id_id_key" ON "hospital_settings"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hospital_settings_tenant_id_key_effective_from_key" ON "hospital_settings"("tenant_id", "key", "effective_from");

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_id_key" ON "branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "hospital_module_subscriptions_tenant_id_idx" ON "hospital_module_subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "hospital_module_subscriptions_tenant_id_id_key" ON "hospital_module_subscriptions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hospital_module_subscriptions_tenant_id_module_id_key" ON "hospital_module_subscriptions"("tenant_id", "module_id");

-- CreateIndex
CREATE INDEX "branch_modules_tenant_id_idx" ON "branch_modules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_modules_tenant_id_id_key" ON "branch_modules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_modules_tenant_id_branch_id_module_id_key" ON "branch_modules"("tenant_id", "branch_id", "module_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_code_key" ON "users"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "user_branches_tenant_id_idx" ON "user_branches"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_tenant_id_id_key" ON "user_branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_tenant_id_user_id_branch_id_key" ON "user_branches"("tenant_id", "user_id", "branch_id");

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "roles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "role_permissions_tenant_id_idx" ON "role_permissions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_tenant_id_id_key" ON "role_permissions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_tenant_id_role_id_permission_id_key" ON "role_permissions"("tenant_id", "role_id", "permission_id");

-- CreateIndex
CREATE INDEX "role_assignments_tenant_id_user_id_idx" ON "role_assignments"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_tenant_id_id_key" ON "role_assignments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "role_assignment_branches_tenant_id_idx" ON "role_assignment_branches"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignment_branches_tenant_id_id_key" ON "role_assignment_branches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignment_branches_tenant_id_assignment_id_branch_id_key" ON "role_assignment_branches"("tenant_id", "assignment_id", "branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "hospital_settings" ADD CONSTRAINT "hospital_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_module_subscriptions" ADD CONSTRAINT "hospital_module_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospital_module_subscriptions" ADD CONSTRAINT "hospital_module_subscriptions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_modules" ADD CONSTRAINT "branch_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_modules" ADD CONSTRAINT "branch_modules_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_modules" ADD CONSTRAINT "branch_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_modules" ADD CONSTRAINT "branch_modules_tenant_id_module_id_fkey" FOREIGN KEY ("tenant_id", "module_id") REFERENCES "hospital_module_subscriptions"("tenant_id", "module_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_branches" ADD CONSTRAINT "role_assignment_branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_branches" ADD CONSTRAINT "role_assignment_branches_tenant_id_assignment_id_fkey" FOREIGN KEY ("tenant_id", "assignment_id") REFERENCES "role_assignments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment_branches" ADD CONSTRAINT "role_assignment_branches_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_actor_user_id_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 3a security: partial unique index, RLS, grants, audit guards, HQ/login

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE UNIQUE INDEX "branches_one_main_per_hospital_uidx"
  ON "branches" ("tenant_id")
  WHERE "is_main" = true;

CREATE UNIQUE INDEX "hospitals_access_code_normalized_uidx"
  ON "hospitals" (lower(trim("access_code")));

CREATE OR REPLACE FUNCTION cuid_like()
RETURNS text
LANGUAGE sql
AS $$
  SELECT replace(gen_random_uuid()::text, '-', '');
$$;

-- SECURITY DEFINER helpers owned by hospigo_security call this; PUBLIC execute is revoked by default privileges.
GRANT EXECUTE ON FUNCTION cuid_like() TO hospigo_security;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hospitals',
    'hospital_settings',
    'branches',
    'hospital_module_subscriptions',
    'branch_modules',
    'users',
    'user_branches',
    'roles',
    'role_permissions',
    'role_assignments',
    'role_assignment_branches',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY hospitals_app_all ON hospitals
  FOR ALL TO hospigo_app
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

CREATE POLICY hospital_settings_app_all ON hospital_settings
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY branches_app_all ON branches
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY hospital_module_subscriptions_app_all ON hospital_module_subscriptions
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY branch_modules_app_all ON branch_modules
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY users_app_all ON users
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY user_branches_app_all ON user_branches
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY roles_app_all ON roles
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY role_permissions_app_all ON role_permissions
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY role_assignments_app_all ON role_assignments
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY role_assignment_branches_app_all ON role_assignment_branches
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY audit_logs_app_select ON audit_logs
  FOR SELECT TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY audit_logs_app_insert ON audit_logs
  FOR INSERT TO hospigo_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY hospitals_hq_all ON hospitals
  FOR ALL TO hospigo_hq
  USING (true) WITH CHECK (true);

CREATE POLICY branches_hq_all ON branches
  FOR ALL TO hospigo_hq
  USING (true) WITH CHECK (true);

CREATE POLICY hospital_module_subscriptions_hq_all ON hospital_module_subscriptions
  FOR ALL TO hospigo_hq
  USING (true) WITH CHECK (true);

CREATE POLICY branch_modules_hq_all ON branch_modules
  FOR ALL TO hospigo_hq
  USING (true) WITH CHECK (true);

CREATE POLICY audit_logs_hq_insert ON audit_logs
  FOR INSERT TO hospigo_hq
  WITH CHECK (true);

CREATE POLICY hospitals_security_select ON hospitals
  FOR SELECT TO hospigo_security
  USING (true);

-- FOR UPDATE in hq_create_first_superadmin requires an UPDATE policy under FORCE RLS.
CREATE POLICY hospitals_security_update ON hospitals
  FOR UPDATE TO hospigo_security
  USING (true)
  WITH CHECK (true);

CREATE POLICY users_security_all ON users
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE POLICY user_branches_security_all ON user_branches
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE POLICY roles_security_all ON roles
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE POLICY role_permissions_security_all ON role_permissions
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE POLICY role_assignments_security_all ON role_assignments
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE POLICY role_assignment_branches_security_all ON role_assignment_branches
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE POLICY branches_security_select ON branches
  FOR SELECT TO hospigo_security
  USING (true);

CREATE POLICY permissions_security_select ON permissions
  FOR SELECT TO hospigo_security
  USING (true);

CREATE POLICY audit_logs_security_insert ON audit_logs
  FOR INSERT TO hospigo_security
  WITH CHECK (true);

GRANT SELECT ON TABLE modules, permissions TO hospigo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  hospitals, hospital_settings, branches, hospital_module_subscriptions, branch_modules,
  users, user_branches, roles, role_permissions, role_assignments, role_assignment_branches
  TO hospigo_app;
GRANT SELECT, INSERT ON TABLE audit_logs TO hospigo_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  hospitals, branches, hospital_module_subscriptions, branch_modules
  TO hospigo_hq;
GRANT INSERT ON TABLE audit_logs TO hospigo_hq;

GRANT SELECT ON TABLE hospitals, branches, permissions TO hospigo_security;
-- UPDATE on hospitals: required for SELECT ... FOR UPDATE in hq_create_first_superadmin.
GRANT UPDATE ON TABLE hospitals TO hospigo_security;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users, user_branches, roles, role_permissions, role_assignments, role_assignment_branches
  TO hospigo_security;
GRANT INSERT ON TABLE audit_logs TO hospigo_security;

GRANT ALL ON ALL TABLES IN SCHEMA public TO hospigo_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO hospigo_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hospigo_owner;

CREATE OR REPLACE FUNCTION refuse_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

CREATE TRIGGER audit_logs_refuse_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_mutation();

CREATE TRIGGER audit_logs_refuse_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_mutation();

CREATE OR REPLACE FUNCTION refuse_audit_truncate_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only (truncate refused)';
END;
$$;

CREATE TRIGGER audit_logs_refuse_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_audit_truncate_stmt();

CREATE OR REPLACE FUNCTION lookup_hospital_id_by_access_code(p_access_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id text;
BEGIN
  SELECT h.id
    INTO v_id
  FROM hospitals h
  WHERE lower(trim(h.access_code)) = lower(trim(p_access_code))
    AND h.status = 'ACTIVE'::hospital_status
    AND h.is_active = true;
  RETURN v_id;
END;
$$;

ALTER FUNCTION lookup_hospital_id_by_access_code(text) OWNER TO hospigo_security;
-- Must SET ROLE: after OWNER TO, only hospigo_security (grantor) can REVOKE/GRANT.
SET ROLE hospigo_security;
REVOKE ALL ON FUNCTION lookup_hospital_id_by_access_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_hospital_id_by_access_code(text) TO hospigo_app;
RESET ROLE;

CREATE OR REPLACE FUNCTION hq_create_first_superadmin(
  p_tenant_id text,
  p_user_code text,
  p_email text,
  p_display_name text,
  p_password_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status hospital_status;
  v_is_active boolean;
  v_role_id text;
  v_user_id text;
  v_assignment_id text;
  v_main_branch_id text;
  v_exists boolean;
BEGIN
  -- Serialize concurrent first-SuperAdmin attempts on the same hospital.
  SELECT h.status, h.is_active
    INTO v_status, v_is_active
  FROM hospitals h
  WHERE h.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hospital not found';
  END IF;

  IF v_status IS DISTINCT FROM 'ACTIVE'::hospital_status OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'hospital is not active';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM role_assignments ra
    JOIN roles r ON r.tenant_id = ra.tenant_id AND r.id = ra.role_id
    WHERE ra.tenant_id = p_tenant_id
      AND r.code = 'SUPER_ADMIN'
      AND ra.is_active = true
  ) INTO v_exists;

  IF v_exists THEN
    RAISE EXCEPTION 'hospital already has a SuperAdmin';
  END IF;

  SELECT id INTO v_role_id
  FROM roles
  WHERE tenant_id = p_tenant_id AND code = 'SUPER_ADMIN' AND is_active = true;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'SUPER_ADMIN role missing for hospital';
  END IF;

  SELECT id INTO v_main_branch_id
  FROM branches
  WHERE tenant_id = p_tenant_id AND is_main = true
  LIMIT 1;

  INSERT INTO users (id, tenant_id, code, email, display_name, password_hash, is_active, created_at, updated_at)
  VALUES (cuid_like(), p_tenant_id, p_user_code, lower(trim(p_email)), p_display_name, p_password_hash, true, NOW(), NOW())
  RETURNING id INTO v_user_id;

  IF v_main_branch_id IS NOT NULL THEN
    INSERT INTO user_branches (id, tenant_id, user_id, branch_id, is_active, created_at, updated_at)
    VALUES (cuid_like(), p_tenant_id, v_user_id, v_main_branch_id, true, NOW(), NOW());
  END IF;

  INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, is_active, created_at, updated_at)
  VALUES (cuid_like(), p_tenant_id, v_user_id, v_role_id, 'HOSPITAL'::role_scope_type, true, NOW(), NOW())
  RETURNING id INTO v_assignment_id;

  INSERT INTO audit_logs (id, tenant_id, actor_user_id, branch_id, action, entity_type, entity_id, reason, metadata, created_at)
  VALUES (
    cuid_like(), p_tenant_id, NULL, v_main_branch_id, 'CREATE_FIRST_SUPERADMIN', 'users', v_user_id,
    'HQ bootstrap', jsonb_build_object('assignment_id', v_assignment_id), NOW()
  );

  RETURN v_user_id;
END;
$$;

ALTER FUNCTION hq_create_first_superadmin(text, text, text, text, text) OWNER TO hospigo_security;
SET ROLE hospigo_security;
REVOKE ALL ON FUNCTION hq_create_first_superadmin(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq_create_first_superadmin(text, text, text, text, text) TO hospigo_hq;
RESET ROLE;

