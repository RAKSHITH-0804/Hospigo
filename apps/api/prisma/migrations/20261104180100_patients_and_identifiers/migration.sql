-- Step 3b-1 Part 2: patients + patient_identifiers (Aadhaar storage undecided — table only, no app fill/search).

CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uhid" TEXT NOT NULL,
    "registered_branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "date_of_birth" DATE,
    "dob_is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "email" TEXT,
    "address_street" TEXT,
    "address_cross" TEXT,
    "address_area" TEXT,
    "address_city" TEXT,
    "address_state" TEXT,
    "address_pincode" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "patients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patients_name_nonempty_chk" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "patients_uhid_text_chk" CHECK (length(btrim("uhid")) > 0)
);

CREATE TABLE "patient_identifiers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "value_encrypted" BYTEA NOT NULL,
    "value_hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "patient_identifiers_pkey" PRIMARY KEY ("id")
);
COMMENT ON TABLE "patient_identifiers" IS
  'Aadhaar and similar identifiers. Schema + RLS only; fill/search rules undecided with manager. No application code writes or searches this table in Step 3b-1.';

CREATE INDEX "patients_tenant_id_phone_idx" ON "patients"("tenant_id", "phone");
CREATE INDEX "patients_tenant_id_idx" ON "patients"("tenant_id");
CREATE INDEX "patients_tenant_id_lower_name_pattern_idx" ON "patients" ("tenant_id", lower("name") text_pattern_ops);
CREATE UNIQUE INDEX "patients_tenant_id_id_key" ON "patients"("tenant_id", "id");
CREATE UNIQUE INDEX "patients_tenant_id_uhid_key" ON "patients"("tenant_id", "uhid");
CREATE INDEX "patient_identifiers_tenant_id_value_hash_idx" ON "patient_identifiers"("tenant_id", "value_hash");
CREATE UNIQUE INDEX "patient_identifiers_tenant_id_id_key" ON "patient_identifiers"("tenant_id", "id");
CREATE UNIQUE INDEX "patient_identifiers_tenant_id_patient_id_identifier_type_key"
  ON "patient_identifiers"("tenant_id", "patient_id", "identifier_type");

ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_registered_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "registered_branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_identifiers" ADD CONSTRAINT "patient_identifiers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_identifiers" ADD CONSTRAINT "patient_identifiers_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_identifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_identifiers" FORCE ROW LEVEL SECURITY;

CREATE POLICY patients_app_all ON patients
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY patient_identifiers_app_all ON patient_identifiers
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON TABLE patients TO hospigo_app;
GRANT SELECT, INSERT, UPDATE ON TABLE patient_identifiers TO hospigo_app;
GRANT ALL ON TABLE patients, patient_identifiers TO hospigo_owner;
-- hospigo_hq: intentionally NO grants (clinical/patient data never for HQ).
