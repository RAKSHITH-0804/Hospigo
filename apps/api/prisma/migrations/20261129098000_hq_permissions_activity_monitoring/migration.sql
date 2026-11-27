-- Phase 2.2 checkpoint 2: HQ Staff tick-box permissions, the append-only HQ activity log, and
-- counts-only monitoring. HQ never reads a clinical table: monitoring goes through one SECURITY
-- DEFINER function that returns numbers and dates only (no names, no money).

-- 1. What each HQ Staff person may do (an HQ Admin has everything; nothing is stored for them).
CREATE TABLE "hq_user_permissions" (
  "id" TEXT NOT NULL,
  "hq_user_id" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "hq_user_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hq_user_permissions_hq_user_fkey" FOREIGN KEY ("hq_user_id") REFERENCES "hq_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hq_user_permissions_pair_key" ON "hq_user_permissions" ("hq_user_id", "permission");
GRANT SELECT, INSERT, DELETE ON TABLE "hq_user_permissions" TO hospigo_hq;
GRANT ALL ON TABLE "hq_user_permissions" TO hospigo_owner;

-- 2. Who in HQ changed what, in which hospital (names and ids only). Append-only; no hospital login can see it.
CREATE TABLE "hq_activity_log" (
  "id" TEXT NOT NULL,
  "hq_user_id" TEXT NOT NULL,
  "tenant_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "hq_activity_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hq_activity_log_hq_user_fkey" FOREIGN KEY ("hq_user_id") REFERENCES "hq_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "hq_activity_log_created_idx" ON "hq_activity_log" ("created_at" DESC);
CREATE INDEX "hq_activity_log_tenant_idx" ON "hq_activity_log" ("tenant_id", "created_at" DESC);
GRANT SELECT, INSERT ON TABLE "hq_activity_log" TO hospigo_hq;
GRANT ALL ON TABLE "hq_activity_log" TO hospigo_owner;
CREATE OR REPLACE FUNCTION refuse_hq_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER hq_activity_log_refuse_update BEFORE UPDATE ON "hq_activity_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_hq_activity_mutation();
CREATE TRIGGER hq_activity_log_refuse_delete BEFORE DELETE ON "hq_activity_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_hq_activity_mutation();
CREATE TRIGGER hq_activity_log_refuse_truncate BEFORE TRUNCATE ON "hq_activity_log"
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_hq_activity_mutation();

-- 3. Counts-only monitoring. The function is owned by hospigo_security. It may read ONLY these
--    columns of opd_visits (no patient, no money), one hospital at a time (same tenant setting as the
--    application), and only through the function. hospigo_hq may run the function and nothing else here.
GRANT SELECT ("id", "tenant_id", "visit_date", "created_at") ON TABLE "opd_visits" TO hospigo_security;
CREATE POLICY opd_visits_security_count ON "opd_visits"
  FOR SELECT TO hospigo_security
  USING (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT ("id", "tenant_id", "last_login_at") ON TABLE "users" TO hospigo_security;

CREATE OR REPLACE FUNCTION hq_hospital_counts(p_today date)
RETURNS TABLE (
  tenant_id text,
  visits_today integer,
  visits_7d integer,
  visits_30d integer,
  active_users_30d integer,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  h record;
  last_activity_login timestamptz;
BEGIN
  FOR h IN SELECT id FROM hospitals ORDER BY id LOOP
    PERFORM set_config('app.tenant_id', h.id, true);
    tenant_id := h.id;
    SELECT
      count(*) FILTER (WHERE v.visit_date = p_today)::integer,
      count(*) FILTER (WHERE v.visit_date > p_today - 7)::integer,
      count(*) FILTER (WHERE v.visit_date > p_today - 30)::integer,
      max(v.created_at)
    INTO visits_today, visits_7d, visits_30d, last_activity
    FROM opd_visits v WHERE v.tenant_id = h.id AND v.visit_date <= p_today;
    SELECT count(*)::integer, max(u.last_login_at)
    INTO active_users_30d, last_activity_login
    FROM users u
    WHERE u.tenant_id = h.id AND u.last_login_at IS NOT NULL
      AND u.last_login_at > (p_today::timestamptz - interval '30 days');
    IF last_activity_login IS NOT NULL AND (last_activity IS NULL OR last_activity_login > last_activity) THEN
      last_activity := last_activity_login;
    END IF;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END;
$$;
ALTER FUNCTION hq_hospital_counts(date) OWNER TO hospigo_security;
SET ROLE hospigo_security;
REVOKE ALL ON FUNCTION hq_hospital_counts(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq_hospital_counts(date) TO hospigo_hq;
RESET ROLE;
