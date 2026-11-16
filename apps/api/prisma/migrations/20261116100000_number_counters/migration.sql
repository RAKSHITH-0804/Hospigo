-- Phase 2 Step 3a: bill/receipt/refund counters, per-branch token counters,
-- and patients identity immutability (uhid + registered_branch_id).

-- Search indexes already exist from 20261104180100_patients_and_identifiers:
--   patients_tenant_id_phone_idx
--   patients_tenant_id_lower_name_pattern_idx
-- (not recreated here).

CREATE TABLE "number_series" (
    "tenant_id" TEXT NOT NULL,
    "series" "number_series_kind" NOT NULL,
    "period_year" INTEGER NOT NULL,
    "last_number" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "number_series_pkey" PRIMARY KEY ("tenant_id", "series", "period_year"),
    CONSTRAINT "number_series_last_number_chk" CHECK ("last_number" >= 0)
);

CREATE TABLE "token_counters" (
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "token_date" DATE NOT NULL,
    "last_token" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "token_counters_pkey" PRIMARY KEY ("tenant_id", "branch_id", "token_date"),
    CONSTRAINT "token_counters_last_token_chk" CHECK ("last_token" >= 0)
);

ALTER TABLE "number_series" ADD CONSTRAINT "number_series_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "token_counters" ADD CONSTRAINT "token_counters_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_counters" ADD CONSTRAINT "token_counters_branch_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "number_series" FORCE ROW LEVEL SECURITY;
ALTER TABLE "token_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY number_series_app_all ON number_series
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY token_counters_app_all ON token_counters
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- hospigo_hq / hospigo_patient: intentionally NO grants.
GRANT SELECT, INSERT, UPDATE ON TABLE number_series, token_counters TO hospigo_app;
GRANT ALL ON TABLE number_series, token_counters TO hospigo_owner;

-- Refuse changing patients.uhid or registered_branch_id after insert.
CREATE OR REPLACE FUNCTION refuse_patient_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.uhid IS DISTINCT FROM OLD.uhid
     OR NEW.registered_branch_id IS DISTINCT FROM OLD.registered_branch_id THEN
    RAISE EXCEPTION 'patients.uhid and registered_branch_id are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_refuse_identity_update
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION refuse_patient_identity_mutation();
