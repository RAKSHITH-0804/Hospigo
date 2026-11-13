-- SECURITY DEFINER lookup: access code -> branch + tenant (active only).
-- Unknown / inactive branch / inactive hospital all return zero rows (identical empty result).

CREATE OR REPLACE FUNCTION lookup_branch_by_access_code(p_access_code text)
RETURNS TABLE(branch_id text, tenant_id text, is_main boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.tenant_id, b.is_main
  FROM branches b
  INNER JOIN hospitals h ON h.id = b.tenant_id
  WHERE lower(trim(b.access_code)) = lower(trim(p_access_code))
    AND b.is_active = true
    AND h.is_active = true
    AND h.status = 'ACTIVE'::hospital_status;
END;
$$;

ALTER FUNCTION lookup_branch_by_access_code(text) OWNER TO hospigo_security;

SET ROLE hospigo_security;
REVOKE ALL ON FUNCTION lookup_branch_by_access_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_branch_by_access_code(text) TO hospigo_app;
RESET ROLE;
