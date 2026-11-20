-- Phase 2 Step 7-3: print templates (paper, margins, layout) per hospital and document type.
--
-- Different hospitals print on different paper: A4, A5, A6, a small label, or pre-printed
-- continuous stationery where only the data is printed into an empty form. A template says which
-- paper, which margins, FULL (Hospigo prints the letterhead) or PREPRINTED (only the data, at
-- positions in mm), and which fields appear. Hospitals without a row use the built-in default of
-- the code, so nothing needs seeding.
--
-- What the database guarantees (so no API bug can store nonsense):
--   * one template per hospital (or per branch) and document type;
--   * a standard paper (A4, A5, A6) has no width or height of its own; a label or custom paper must
--     have both, between 20 and 1000 mm; margins 0 to 100 mm; the layout is a JSON object of
--     bounded size (its fields are validated in code);
--   * the hospital, branch, document type and creator never change after the row exists;
--   * forced row level security by hospital; hospigo_hq / hospigo_patient have NO grants;
--     the app role can only change the setting columns (never the identity), and can delete a row
--     (a reset to the built-in default); the audit log records every change.
-- Who may change a template (settings permission) is the API's job.

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------

CREATE TYPE "print_doc_type" AS ENUM ('REGISTRATION_SLIP', 'RECEIPT', 'PRESCRIPTION');
CREATE TYPE "print_paper" AS ENUM ('A4', 'A5', 'A6', 'LABEL', 'CUSTOM');
CREATE TYPE "print_orientation" AS ENUM ('PORTRAIT', 'LANDSCAPE');
CREATE TYPE "print_mode" AS ENUM ('FULL', 'PREPRINTED');

-- ---------------------------------------------------------------------------------------------
-- print_templates
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "print_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "doc_type" "print_doc_type" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paper" "print_paper" NOT NULL,
    "width_mm" DECIMAL(6,1),
    "height_mm" DECIMAL(6,1),
    "orientation" "print_orientation" NOT NULL DEFAULT 'PORTRAIT',
    "margin_top_mm" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "margin_right_mm" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "margin_bottom_mm" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "margin_left_mm" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "mode" "print_mode" NOT NULL DEFAULT 'FULL',
    "preset" TEXT,
    "layout" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "print_templates_pkey" PRIMARY KEY ("id"),
    -- A standard paper has its own size; a label or custom paper must say its size.
    CONSTRAINT "print_templates_paper_size_chk" CHECK (
      ("paper" IN ('LABEL', 'CUSTOM') AND "width_mm" IS NOT NULL AND "height_mm" IS NOT NULL)
      OR ("paper" IN ('A4', 'A5', 'A6') AND "width_mm" IS NULL AND "height_mm" IS NULL)
    ),
    CONSTRAINT "print_templates_size_range_chk" CHECK (
      ("width_mm" IS NULL OR ("width_mm" >= 20 AND "width_mm" <= 1000))
      AND ("height_mm" IS NULL OR ("height_mm" >= 20 AND "height_mm" <= 1000))
    ),
    CONSTRAINT "print_templates_margins_chk" CHECK (
      "margin_top_mm" BETWEEN 0 AND 100 AND "margin_right_mm" BETWEEN 0 AND 100
      AND "margin_bottom_mm" BETWEEN 0 AND 100 AND "margin_left_mm" BETWEEN 0 AND 100
    ),
    CONSTRAINT "print_templates_layout_chk" CHECK (
      jsonb_typeof("layout") = 'object' AND octet_length("layout"::text) <= 16000
    ),
    CONSTRAINT "print_templates_preset_chk" CHECK (
      "preset" IS NULL OR (length(btrim("preset")) >= 1 AND length("preset") <= 40)
    )
);

CREATE UNIQUE INDEX "print_templates_tenant_id_id_key" ON "print_templates"("tenant_id", "id");
-- One template per hospital-wide (no branch) or per-branch scope and document type.
CREATE UNIQUE INDEX "print_templates_scope_doc_key"
  ON "print_templates"("tenant_id", (coalesce("branch_id", '')), "doc_type");

ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_branch_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_updated_by_fkey"
  FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row level security (hospital), grants
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "print_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_templates" FORCE ROW LEVEL SECURITY;

CREATE POLICY print_templates_app_all ON print_templates
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- hospigo_hq / hospigo_patient: intentionally NO grants. The app role can read, add, delete (a reset
-- to the built-in default) and change only the setting columns.
GRANT SELECT, INSERT, DELETE ON TABLE print_templates TO hospigo_app;
GRANT UPDATE (
  "enabled", "paper", "width_mm", "height_mm", "orientation", "margin_top_mm", "margin_right_mm",
  "margin_bottom_mm", "margin_left_mm", "mode", "preset", "layout", "updated_by", "updated_at"
) ON TABLE print_templates TO hospigo_app;
GRANT ALL ON TABLE print_templates TO hospigo_owner;

CREATE TRIGGER print_templates_refuse_truncate BEFORE TRUNCATE ON print_templates
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- ---------------------------------------------------------------------------------------------
-- The identity of a template never changes (only its settings do)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION print_templates_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.doc_type, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.doc_type, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'print template identity columns are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER print_templates_guard_update BEFORE UPDATE ON print_templates
  FOR EACH ROW EXECUTE FUNCTION print_templates_guard_update();
