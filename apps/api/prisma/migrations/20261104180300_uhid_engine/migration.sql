-- Step 3b-1 Part 4: UHID format configs, blocks, hospital-wide counters.

CREATE TYPE "uhid_reset_rule" AS ENUM ('NEVER', 'FINANCIAL_YEAR');
CREATE TYPE "uhid_block_type" AS ENUM ('FIXED_TEXT', 'BRANCH_CODE', 'FINANCIAL_YEAR', 'CALENDAR_YEAR', 'SEPARATOR', 'RUNNING_NUMBER');
CREATE TYPE "uhid_fy_style" AS ENUM ('SHORT', 'LONG');

CREATE TABLE "uhid_format_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "reset_rule" "uhid_reset_rule" NOT NULL,
    "fy_start_month" INTEGER NOT NULL DEFAULT 4,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uhid_format_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uhid_format_configs_fy_month_chk" CHECK ("fy_start_month" BETWEEN 1 AND 12)
);

CREATE TABLE "uhid_format_blocks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "block_type" "uhid_block_type" NOT NULL,
    "text_value" TEXT,
    "fy_style" "uhid_fy_style",
    "min_width" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uhid_format_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uhid_format_blocks_min_width_chk" CHECK ("min_width" IS NULL OR "min_width" >= 1)
);

CREATE TABLE "uhid_counters" (
    "tenant_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "last_number" BIGINT NOT NULL,
    CONSTRAINT "uhid_counters_pkey" PRIMARY KEY ("tenant_id","period_year"),
    CONSTRAINT "uhid_counters_last_number_nonneg_chk" CHECK ("last_number" >= 0)
);

CREATE INDEX "uhid_format_configs_tenant_id_effective_from_idx"
  ON "uhid_format_configs"("tenant_id", "effective_from");
CREATE UNIQUE INDEX "uhid_format_configs_tenant_id_id_key" ON "uhid_format_configs"("tenant_id", "id");
CREATE INDEX "uhid_format_blocks_tenant_id_config_id_idx" ON "uhid_format_blocks"("tenant_id", "config_id");
CREATE UNIQUE INDEX "uhid_format_blocks_tenant_id_id_key" ON "uhid_format_blocks"("tenant_id", "id");
CREATE UNIQUE INDEX "uhid_format_blocks_tenant_id_config_id_position_key"
  ON "uhid_format_blocks"("tenant_id", "config_id", "position");

ALTER TABLE "uhid_format_configs" ADD CONSTRAINT "uhid_format_configs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uhid_format_configs" ADD CONSTRAINT "uhid_format_configs_tenant_id_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uhid_format_blocks" ADD CONSTRAINT "uhid_format_blocks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uhid_format_blocks" ADD CONSTRAINT "uhid_format_blocks_tenant_id_config_id_fkey"
  FOREIGN KEY ("tenant_id", "config_id") REFERENCES "uhid_format_configs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uhid_counters" ADD CONSTRAINT "uhid_counters_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one RUNNING_NUMBER per config (enforced after blocks exist via trigger on insert/update/delete).
CREATE OR REPLACE FUNCTION uhid_format_blocks_validate_running_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_config_id text;
  v_tenant_id text;
  v_count int;
  v_reset uhid_reset_rule;
  v_fy_count int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_config_id := OLD.config_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_config_id := NEW.config_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  SELECT count(*) INTO v_count
  FROM uhid_format_blocks
  WHERE tenant_id = v_tenant_id AND config_id = v_config_id AND block_type = 'RUNNING_NUMBER';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'uhid format config must have exactly one RUNNING_NUMBER block (found %)', v_count;
  END IF;

  SELECT reset_rule INTO v_reset
  FROM uhid_format_configs
  WHERE tenant_id = v_tenant_id AND id = v_config_id;

  IF v_reset = 'FINANCIAL_YEAR' THEN
    SELECT count(*) INTO v_fy_count
    FROM uhid_format_blocks
    WHERE tenant_id = v_tenant_id AND config_id = v_config_id AND block_type = 'FINANCIAL_YEAR';
    IF v_fy_count < 1 THEN
      RAISE EXCEPTION 'uhid FINANCIAL_YEAR reset_rule requires at least one FINANCIAL_YEAR block';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Deferred validation: allow inserting blocks then validate at statement end via constraint trigger,
-- but statement-level AFTER INSERT OR UPDATE OR DELETE is simpler with a deferred check function
-- called from service. DB also validates on each change after the first RUNNING_NUMBER exists.
-- Use CONSTRAINT TRIGGER DEFERRABLE so multi-row inserts in one tx can complete first.
CREATE CONSTRAINT TRIGGER uhid_format_blocks_validate_trg
  AFTER INSERT OR UPDATE OR DELETE ON uhid_format_blocks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION uhid_format_blocks_validate_running_number();

-- Also validate when reset_rule changes on config (must already have FY block if FINANCIAL_YEAR).
CREATE OR REPLACE FUNCTION uhid_format_configs_validate_reset_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_fy_count int;
  v_rn_count int;
BEGIN
  IF NEW.reset_rule = 'FINANCIAL_YEAR' THEN
    SELECT count(*) INTO v_fy_count
    FROM uhid_format_blocks
    WHERE tenant_id = NEW.tenant_id AND config_id = NEW.id AND block_type = 'FINANCIAL_YEAR';
    -- Configs are immutable in app; if blocks already exist, enforce. Zero blocks = still being assembled.
    IF EXISTS (SELECT 1 FROM uhid_format_blocks WHERE tenant_id = NEW.tenant_id AND config_id = NEW.id)
       AND v_fy_count < 1 THEN
      RAISE EXCEPTION 'uhid FINANCIAL_YEAR reset_rule requires at least one FINANCIAL_YEAR block';
    END IF;
  END IF;

  SELECT count(*) INTO v_rn_count
  FROM uhid_format_blocks
  WHERE tenant_id = NEW.tenant_id AND config_id = NEW.id AND block_type = 'RUNNING_NUMBER';
  IF EXISTS (SELECT 1 FROM uhid_format_blocks WHERE tenant_id = NEW.tenant_id AND config_id = NEW.id)
     AND v_rn_count <> 1 THEN
    RAISE EXCEPTION 'uhid format config must have exactly one RUNNING_NUMBER block (found %)', v_rn_count;
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER uhid_format_configs_validate_trg
  AFTER INSERT OR UPDATE ON uhid_format_configs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION uhid_format_configs_validate_reset_rule();

-- Raise-only: refuse decreases of last_number.
CREATE OR REPLACE FUNCTION uhid_counters_refuse_decrease()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_number < OLD.last_number THEN
    RAISE EXCEPTION 'uhid counter last_number cannot be decreased (raise-only)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER uhid_counters_refuse_decrease_trg
  BEFORE UPDATE ON uhid_counters
  FOR EACH ROW
  EXECUTE FUNCTION uhid_counters_refuse_decrease();

ALTER TABLE "uhid_format_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uhid_format_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "uhid_format_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uhid_format_blocks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "uhid_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uhid_counters" FORCE ROW LEVEL SECURITY;

CREATE POLICY uhid_format_configs_app_all ON uhid_format_configs
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY uhid_format_blocks_app_all ON uhid_format_blocks
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY uhid_counters_app_all ON uhid_counters
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE uhid_format_configs, uhid_format_blocks TO hospigo_app;
GRANT SELECT, INSERT, UPDATE ON TABLE uhid_counters TO hospigo_app;
GRANT ALL ON TABLE uhid_format_configs, uhid_format_blocks, uhid_counters TO hospigo_owner;
-- hospigo_hq: no access to UHID tables in this step.
