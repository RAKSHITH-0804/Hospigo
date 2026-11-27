-- Phase 2.2 checkpoint 2: HQ lists the Super Admin accounts of a hospital and resets one to a one-time
-- password WITHOUT entering the hospital. Both are SECURITY DEFINER functions owned by hospigo_security
-- (like hq_create_first_superadmin); the HQ login gets no table access. Ending the old sessions needs one
-- narrow right on auth_sessions (revoked_at only).

GRANT SELECT ("id", "tenant_id", "user_id", "revoked_at"), UPDATE ("revoked_at") ON TABLE "auth_sessions" TO hospigo_security;
CREATE POLICY auth_sessions_security_revoke ON "auth_sessions"
  FOR ALL TO hospigo_security
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION hq_list_superadmins(p_tenant_id text)
RETURNS TABLE (id text, email text, display_name text, is_active boolean, last_login_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.email, u.display_name, u.is_active, u.last_login_at
  FROM users u
  WHERE u.tenant_id = p_tenant_id
    AND EXISTS (
      SELECT 1 FROM role_assignments ra
      JOIN roles r ON r.tenant_id = ra.tenant_id AND r.id = ra.role_id
      WHERE ra.tenant_id = u.tenant_id AND ra.user_id = u.id AND ra.is_active AND r.code = 'SUPER_ADMIN'
    )
  ORDER BY u.display_name;
$$;
ALTER FUNCTION hq_list_superadmins(text) OWNER TO hospigo_security;
SET ROLE hospigo_security;
REVOKE ALL ON FUNCTION hq_list_superadmins(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq_list_superadmins(text) TO hospigo_hq;
RESET ROLE;

CREATE OR REPLACE FUNCTION hq_reset_superadmin(p_tenant_id text, p_user_id text, p_password_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN role_assignments ra ON ra.tenant_id = u.tenant_id AND ra.user_id = u.id AND ra.is_active
    JOIN roles r ON r.tenant_id = ra.tenant_id AND r.id = ra.role_id AND r.code = 'SUPER_ADMIN'
    WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id
  ) INTO v_ok;
  IF NOT v_ok THEN
    RETURN false;
  END IF;
  UPDATE users SET password_hash = p_password_hash, must_change_password = true, is_active = true, updated_at = NOW()
  WHERE tenant_id = p_tenant_id AND id = p_user_id;
  UPDATE auth_sessions SET revoked_at = NOW()
  WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND revoked_at IS NULL;
  INSERT INTO audit_logs (id, tenant_id, actor_user_id, branch_id, action, entity_type, entity_id, reason, metadata, created_at)
  VALUES (cuid_like(), p_tenant_id, NULL, NULL, 'HQ_RESET_SUPERADMIN_PASSWORD', 'users', p_user_id, 'HQ one-time password', '{}'::jsonb, NOW());
  RETURN true;
END;
$$;
ALTER FUNCTION hq_reset_superadmin(text, text, text) OWNER TO hospigo_security;
SET ROLE hospigo_security;
REVOKE ALL ON FUNCTION hq_reset_superadmin(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq_reset_superadmin(text, text, text) TO hospigo_hq;
RESET ROLE;
