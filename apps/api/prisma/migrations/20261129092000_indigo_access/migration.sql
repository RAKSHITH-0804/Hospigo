-- Step 2.1b: Indigo users (Owner and Employee) act inside a hospital through a hidden, flagged user.

-- Who an Indigo user is: Owner (full power) or Employee (assigned hospitals only).
ALTER TABLE "hq_users"
  ADD COLUMN "indigo_role" TEXT NOT NULL DEFAULT 'OWNER',
  ADD CONSTRAINT "hq_users_indigo_role_chk" CHECK ("indigo_role" IN ('OWNER', 'EMPLOYEE'));

-- The hospitals an Employee may enter (an Owner may enter every hospital).
CREATE TABLE "hq_user_hospitals" (
  "id" TEXT NOT NULL,
  "hq_user_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hq_user_hospitals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hq_user_hospitals_hq_user_fkey" FOREIGN KEY ("hq_user_id") REFERENCES "hq_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hq_user_hospitals_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hq_user_hospitals_pair_key" ON "hq_user_hospitals" ("hq_user_id", "tenant_id");
GRANT SELECT, INSERT, DELETE ON TABLE "hq_user_hospitals" TO hospigo_hq;
GRANT ALL ON TABLE "hq_user_hospitals" TO hospigo_owner;

-- The hidden user inside a hospital that stands for one Indigo person.
ALTER TABLE "users" ADD COLUMN "indigo_hq_user_id" TEXT;
CREATE UNIQUE INDEX "users_indigo_hq_user_key" ON "users" ("tenant_id", "indigo_hq_user_id")
  WHERE "indigo_hq_user_id" IS NOT NULL;

-- Only the Indigo entry code may set the flag (it says so in the transaction); the flag never changes.
CREATE OR REPLACE FUNCTION users_indigo_flag_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.indigo_hq_user_id IS NOT NULL
       AND current_setting('app.indigo_enter', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'only the Indigo entry may create an Indigo user' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.indigo_hq_user_id IS DISTINCT FROM OLD.indigo_hq_user_id THEN
    RAISE EXCEPTION 'the Indigo flag of a user cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_indigo_flag_guard BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_indigo_flag_guard();

-- Every time an Indigo person enters or switches hospital: who, which hospital, when. Append-only.
CREATE TABLE "indigo_access_log" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "hq_user_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "indigo_access_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "indigo_access_log_action_chk" CHECK ("action" IN ('ENTER', 'REFRESH', 'DENIED')),
  CONSTRAINT "indigo_access_log_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "indigo_access_log_tenant_idx" ON "indigo_access_log" ("tenant_id", "created_at" DESC);
CREATE INDEX "indigo_access_log_person_idx" ON "indigo_access_log" ("hq_user_id", "created_at" DESC);

ALTER TABLE "indigo_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "indigo_access_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY indigo_access_log_app_select ON "indigo_access_log"
  FOR SELECT TO hospigo_app USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY indigo_access_log_app_insert ON "indigo_access_log"
  FOR INSERT TO hospigo_app WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY indigo_access_log_hq_select ON "indigo_access_log"
  FOR SELECT TO hospigo_hq USING (true);
CREATE POLICY indigo_access_log_hq_insert ON "indigo_access_log"
  FOR INSERT TO hospigo_hq WITH CHECK (true);
GRANT SELECT, INSERT ON TABLE "indigo_access_log" TO hospigo_app, hospigo_hq;
GRANT ALL ON TABLE "indigo_access_log" TO hospigo_owner;

CREATE OR REPLACE FUNCTION refuse_indigo_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER indigo_access_log_refuse_update BEFORE UPDATE ON "indigo_access_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_indigo_log_mutation();
CREATE TRIGGER indigo_access_log_refuse_delete BEFORE DELETE ON "indigo_access_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_indigo_log_mutation();
CREATE TRIGGER indigo_access_log_refuse_truncate BEFORE TRUNCATE ON "indigo_access_log"
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_indigo_log_mutation();
