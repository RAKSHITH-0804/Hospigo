-- Phase 2 Step 2: OPD masters, settings, versioned prices (append-only).

CREATE TYPE "charge_item_kind" AS ENUM ('CONSULTATION', 'REGISTRATION', 'INVESTIGATION');
CREATE TYPE "visit_type" AS ENUM ('NEW', 'FOLLOW_UP');
CREATE TYPE "vitals_value_kind" AS ENUM ('NUMBER', 'TEXT');
CREATE TYPE "number_series_kind" AS ENUM ('BILL', 'RECEIPT', 'REFUND');

-- Reuses existing uhid_reset_rule (NEVER | FINANCIAL_YEAR) for number_series_settings.reset_rule.
-- FINANCIAL_YEAR corresponds to the design doc's YEARLY.

CREATE TABLE "doctor_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "department" TEXT,
    "availability_on" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "doctor_timings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "doctor_timings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doctor_timings_weekday_chk" CHECK ("weekday" >= 0 AND "weekday" <= 6),
    CONSTRAINT "doctor_timings_time_chk" CHECK ("start_time" < "end_time")
);

CREATE TABLE "doctor_leave" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "doctor_leave_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doctor_leave_dates_chk" CHECK ("to_date" >= "from_date")
);

CREATE TABLE "charge_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "charge_item_kind" NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "charge_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "charge_items_tax_rate_bp_chk" CHECK ("tax_rate_bp" >= 0 AND "tax_rate_bp" <= 10000)
);

CREATE TABLE "charge_item_prices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "charge_item_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "charge_item_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "charge_item_prices_amount_chk" CHECK ("amount_paise" >= 0)
);

CREATE TABLE "doctor_fees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "visit_type" "visit_type" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doctor_fees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doctor_fees_amount_chk" CHECK ("amount_paise" >= 0)
);

CREATE TABLE "medicines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "composition" TEXT,
    "form" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vitals_fields" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "value_kind" "vitals_value_kind" NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "warn_min" DECIMAL(10,2),
    "warn_max" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "vitals_fields_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vitals_fields_warn_chk" CHECK ("warn_min" IS NULL OR "warn_max" IS NULL OR "warn_min" <= "warn_max")
);

CREATE TABLE "payment_modes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requires_reference" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opd_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "follow_up_free_days" INTEGER NOT NULL DEFAULT 7,
    "token_prefix" TEXT NOT NULL DEFAULT 'T',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "tax_enabled" BOOLEAN NOT NULL DEFAULT false,
    "tax_name" TEXT,
    "tax_registration_no" TEXT,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "opd_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opd_settings_follow_up_chk" CHECK ("follow_up_free_days" >= 0 AND "follow_up_free_days" <= 365)
);

CREATE TABLE "number_series_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "series" "number_series_kind" NOT NULL,
    "format" JSONB NOT NULL,
    "reset_rule" "uhid_reset_rule" NOT NULL,
    "fy_start_month" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "number_series_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "number_series_settings_fy_month_chk" CHECK ("fy_start_month" >= 1 AND "fy_start_month" <= 12)
);

-- Uniques / indexes
CREATE UNIQUE INDEX "doctor_profiles_tenant_id_id_key" ON "doctor_profiles"("tenant_id", "id");
CREATE UNIQUE INDEX "doctor_profiles_tenant_id_user_id_key" ON "doctor_profiles"("tenant_id", "user_id");
CREATE UNIQUE INDEX "doctor_profiles_tenant_id_code_key" ON "doctor_profiles"("tenant_id", "code");
CREATE INDEX "doctor_profiles_tenant_id_idx" ON "doctor_profiles"("tenant_id");

CREATE UNIQUE INDEX "doctor_timings_tenant_id_id_key" ON "doctor_timings"("tenant_id", "id");
CREATE INDEX "doctor_timings_tenant_doctor_branch_idx" ON "doctor_timings"("tenant_id", "doctor_profile_id", "branch_id");

CREATE UNIQUE INDEX "doctor_leave_tenant_id_id_key" ON "doctor_leave"("tenant_id", "id");
CREATE INDEX "doctor_leave_tenant_doctor_idx" ON "doctor_leave"("tenant_id", "doctor_profile_id");

CREATE UNIQUE INDEX "charge_items_tenant_id_id_key" ON "charge_items"("tenant_id", "id");
CREATE UNIQUE INDEX "charge_items_tenant_id_code_key" ON "charge_items"("tenant_id", "code");
CREATE INDEX "charge_items_tenant_id_idx" ON "charge_items"("tenant_id");

CREATE UNIQUE INDEX "charge_item_prices_tenant_id_id_key" ON "charge_item_prices"("tenant_id", "id");
CREATE UNIQUE INDEX "charge_item_prices_tenant_item_from_key" ON "charge_item_prices"("tenant_id", "charge_item_id", "effective_from");
CREATE INDEX "charge_item_prices_lookup_idx" ON "charge_item_prices"("tenant_id", "charge_item_id", "effective_from");

CREATE UNIQUE INDEX "doctor_fees_tenant_id_id_key" ON "doctor_fees"("tenant_id", "id");
CREATE UNIQUE INDEX "doctor_fees_tenant_doctor_type_from_key" ON "doctor_fees"("tenant_id", "doctor_profile_id", "visit_type", "effective_from");
CREATE INDEX "doctor_fees_lookup_idx" ON "doctor_fees"("tenant_id", "doctor_profile_id", "visit_type", "effective_from");

CREATE UNIQUE INDEX "medicines_tenant_id_id_key" ON "medicines"("tenant_id", "id");
CREATE UNIQUE INDEX "medicines_tenant_id_code_key" ON "medicines"("tenant_id", "code");
CREATE INDEX "medicines_tenant_id_idx" ON "medicines"("tenant_id");

CREATE UNIQUE INDEX "vitals_fields_tenant_id_id_key" ON "vitals_fields"("tenant_id", "id");
CREATE UNIQUE INDEX "vitals_fields_tenant_id_code_key" ON "vitals_fields"("tenant_id", "code");
CREATE INDEX "vitals_fields_tenant_id_idx" ON "vitals_fields"("tenant_id");

CREATE UNIQUE INDEX "payment_modes_tenant_id_id_key" ON "payment_modes"("tenant_id", "id");
CREATE UNIQUE INDEX "payment_modes_tenant_id_code_key" ON "payment_modes"("tenant_id", "code");

CREATE UNIQUE INDEX "opd_settings_tenant_id_id_key" ON "opd_settings"("tenant_id", "id");
CREATE UNIQUE INDEX "opd_settings_tenant_id_key" ON "opd_settings"("tenant_id");

CREATE UNIQUE INDEX "number_series_settings_tenant_id_id_key" ON "number_series_settings"("tenant_id", "id");
CREATE UNIQUE INDEX "number_series_settings_tenant_series_key" ON "number_series_settings"("tenant_id", "series");

-- FKs (composite where needed)
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_tenant_user_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_timings" ADD CONSTRAINT "doctor_timings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_timings" ADD CONSTRAINT "doctor_timings_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_timings" ADD CONSTRAINT "doctor_timings_branch_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_leave" ADD CONSTRAINT "doctor_leave_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_leave" ADD CONSTRAINT "doctor_leave_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "charge_items" ADD CONSTRAINT "charge_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "charge_item_prices" ADD CONSTRAINT "charge_item_prices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "charge_item_prices" ADD CONSTRAINT "charge_item_prices_item_fkey"
  FOREIGN KEY ("tenant_id", "charge_item_id") REFERENCES "charge_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charge_item_prices" ADD CONSTRAINT "charge_item_prices_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_fees" ADD CONSTRAINT "doctor_fees_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_fees" ADD CONSTRAINT "doctor_fees_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_fees" ADD CONSTRAINT "doctor_fees_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "medicines" ADD CONSTRAINT "medicines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vitals_fields" ADD CONSTRAINT "vitals_fields_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opd_settings" ADD CONSTRAINT "opd_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "number_series_settings" ADD CONSTRAINT "number_series_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS
ALTER TABLE "doctor_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "doctor_timings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_timings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "doctor_leave" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_leave" FORCE ROW LEVEL SECURITY;
ALTER TABLE "charge_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charge_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "charge_item_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charge_item_prices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "doctor_fees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_fees" FORCE ROW LEVEL SECURITY;
ALTER TABLE "medicines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medicines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "vitals_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vitals_fields" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_modes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_modes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "opd_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opd_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "number_series_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "number_series_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY doctor_profiles_app_all ON doctor_profiles
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY doctor_timings_app_all ON doctor_timings
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY doctor_leave_app_all ON doctor_leave
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY charge_items_app_all ON charge_items
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY charge_item_prices_app_all ON charge_item_prices
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY doctor_fees_app_all ON doctor_fees
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY medicines_app_all ON medicines
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY vitals_fields_app_all ON vitals_fields
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY payment_modes_app_all ON payment_modes
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY opd_settings_app_all ON opd_settings
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY number_series_settings_app_all ON number_series_settings
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Grants: masters SELECT/INSERT/UPDATE (no DELETE); price tables SELECT/INSERT only.
-- hospigo_hq / hospigo_patient: intentionally NO grants.
GRANT SELECT, INSERT, UPDATE ON TABLE
  doctor_profiles, doctor_timings, doctor_leave, charge_items, medicines,
  vitals_fields, payment_modes, opd_settings, number_series_settings
  TO hospigo_app;
GRANT SELECT, INSERT ON TABLE charge_item_prices, doctor_fees TO hospigo_app;
GRANT ALL ON TABLE
  doctor_profiles, doctor_timings, doctor_leave, charge_items, charge_item_prices,
  doctor_fees, medicines, vitals_fields, payment_modes, opd_settings, number_series_settings
  TO hospigo_owner;

-- Append-only triggers (also bind owner login)
CREATE OR REPLACE FUNCTION refuse_opd_price_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER charge_item_prices_refuse_update
  BEFORE UPDATE ON charge_item_prices
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER charge_item_prices_refuse_delete
  BEFORE DELETE ON charge_item_prices
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER doctor_fees_refuse_update
  BEFORE UPDATE ON doctor_fees
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER doctor_fees_refuse_delete
  BEFORE DELETE ON doctor_fees
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();

-- Statement-level TRUNCATE refusal (same idea as audit_logs_refuse_truncate)
CREATE OR REPLACE FUNCTION refuse_opd_price_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% are append-only (truncate refused)', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER charge_item_prices_refuse_truncate
  BEFORE TRUNCATE ON charge_item_prices
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();
CREATE TRIGGER doctor_fees_refuse_truncate
  BEFORE TRUNCATE ON doctor_fees
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();
