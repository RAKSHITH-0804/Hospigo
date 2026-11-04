-- Step 3b-1 Part 3: patient field catalog (global) + tenant field settings / custom fields.

CREATE TYPE "patient_custom_field_data_type" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'DROPDOWN');

CREATE TABLE "patient_field_catalog" (
    "key" TEXT NOT NULL,
    "default_label" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "can_disable" BOOLEAN NOT NULL,
    "always_required" BOOLEAN NOT NULL,
    CONSTRAINT "patient_field_catalog_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "patient_custom_fields" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data_type" "patient_custom_field_data_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "patient_custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient_custom_field_options" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "patient_custom_field_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient_custom_field_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value_text" TEXT,
    "value_number" DECIMAL(18,4),
    "value_date" DATE,
    "option_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "patient_custom_field_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient_field_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "catalog_key" TEXT,
    "custom_field_id" TEXT,
    "is_enabled" BOOLEAN NOT NULL,
    "is_required" BOOLEAN NOT NULL,
    "label" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "changed_by" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "patient_field_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_field_settings_exactly_one_src_chk" CHECK (
      (("catalog_key" IS NOT NULL)::int + ("custom_field_id" IS NOT NULL)::int) = 1
    )
);

CREATE INDEX "patient_custom_fields_tenant_id_idx" ON "patient_custom_fields"("tenant_id");
CREATE UNIQUE INDEX "patient_custom_fields_tenant_id_id_key" ON "patient_custom_fields"("tenant_id", "id");
CREATE UNIQUE INDEX "patient_custom_fields_tenant_id_code_key" ON "patient_custom_fields"("tenant_id", "code");
CREATE INDEX "patient_custom_field_options_tenant_id_field_id_idx" ON "patient_custom_field_options"("tenant_id", "field_id");
CREATE UNIQUE INDEX "patient_custom_field_options_tenant_id_id_key" ON "patient_custom_field_options"("tenant_id", "id");
CREATE INDEX "patient_custom_field_values_tenant_id_idx" ON "patient_custom_field_values"("tenant_id");
CREATE UNIQUE INDEX "patient_custom_field_values_tenant_id_id_key" ON "patient_custom_field_values"("tenant_id", "id");
CREATE UNIQUE INDEX "patient_custom_field_values_tenant_id_patient_id_field_id_key"
  ON "patient_custom_field_values"("tenant_id", "patient_id", "field_id");
CREATE INDEX "patient_field_settings_tenant_id_idx" ON "patient_field_settings"("tenant_id");
CREATE UNIQUE INDEX "patient_field_settings_tenant_id_id_key" ON "patient_field_settings"("tenant_id", "id");
CREATE UNIQUE INDEX "patient_field_settings_tenant_id_catalog_key_key"
  ON "patient_field_settings"("tenant_id", "catalog_key");
CREATE UNIQUE INDEX "patient_field_settings_tenant_id_custom_field_id_key"
  ON "patient_field_settings"("tenant_id", "custom_field_id");

ALTER TABLE "patient_custom_fields" ADD CONSTRAINT "patient_custom_fields_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_custom_field_options" ADD CONSTRAINT "patient_custom_field_options_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_custom_field_options" ADD CONSTRAINT "patient_custom_field_options_tenant_id_field_id_fkey"
  FOREIGN KEY ("tenant_id", "field_id") REFERENCES "patient_custom_fields"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_custom_field_values" ADD CONSTRAINT "patient_custom_field_values_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_custom_field_values" ADD CONSTRAINT "patient_custom_field_values_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_custom_field_values" ADD CONSTRAINT "patient_custom_field_values_tenant_id_field_id_fkey"
  FOREIGN KEY ("tenant_id", "field_id") REFERENCES "patient_custom_fields"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_custom_field_values" ADD CONSTRAINT "patient_custom_field_values_tenant_id_option_id_fkey"
  FOREIGN KEY ("tenant_id", "option_id") REFERENCES "patient_custom_field_options"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "patient_field_settings" ADD CONSTRAINT "patient_field_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_field_settings" ADD CONSTRAINT "patient_field_settings_catalog_key_fkey"
  FOREIGN KEY ("catalog_key") REFERENCES "patient_field_catalog"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_field_settings" ADD CONSTRAINT "patient_field_settings_tenant_id_custom_field_id_fkey"
  FOREIGN KEY ("tenant_id", "custom_field_id") REFERENCES "patient_custom_fields"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_field_settings" ADD CONSTRAINT "patient_field_settings_tenant_id_changed_by_fkey"
  FOREIGN KEY ("tenant_id", "changed_by") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Global catalog: no RLS (allowlisted). Tenant tables: FORCE RLS.
ALTER TABLE "patient_custom_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_custom_fields" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_custom_field_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_custom_field_options" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_custom_field_values" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_field_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_field_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_custom_fields_app_all ON patient_custom_fields
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY patient_custom_field_options_app_all ON patient_custom_field_options
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY patient_custom_field_values_app_all ON patient_custom_field_values
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY patient_field_settings_app_all ON patient_field_settings
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT ON TABLE patient_field_catalog TO hospigo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  patient_custom_fields, patient_custom_field_options, patient_custom_field_values, patient_field_settings
  TO hospigo_app;
GRANT ALL ON TABLE
  patient_field_catalog, patient_custom_fields, patient_custom_field_options,
  patient_custom_field_values, patient_field_settings
  TO hospigo_owner;
