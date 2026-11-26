-- Step 2.1a (items 1, 2, 3, 6)

-- (3) Templates saved so far as "prescription" were the full patient report. Copy each of them to
-- PATIENT_REPORT (same scope, same layout), then retire the old row (nothing is deleted): the slim
-- PRESCRIPTION starts from its own default and never renders an old layout with empty boxes.
ALTER TABLE "print_templates" ADD COLUMN "retired_at" TIMESTAMPTZ(3);

INSERT INTO "print_templates" (
  "id", "tenant_id", "branch_id", "doc_type", "enabled", "paper", "width_mm", "height_mm",
  "orientation", "margin_top_mm", "margin_right_mm", "margin_bottom_mm", "margin_left_mm",
  "mode", "preset", "layout", "created_by", "updated_by", "created_at", "updated_at"
)
SELECT
  'ptr' || replace(gen_random_uuid()::text, '-', ''), "tenant_id", "branch_id", 'PATIENT_REPORT',
  "enabled", "paper", "width_mm", "height_mm", "orientation", "margin_top_mm", "margin_right_mm",
  "margin_bottom_mm", "margin_left_mm", "mode", "preset", "layout", "created_by", "updated_by",
  "created_at", "updated_at"
FROM "print_templates"
WHERE "doc_type" = 'PRESCRIPTION';

UPDATE "print_templates" SET "retired_at" = now() WHERE "doc_type" = 'PRESCRIPTION';

-- one live template per scope and document type (a retired row does not count)
DROP INDEX "print_templates_scope_doc_key";
CREATE UNIQUE INDEX "print_templates_scope_doc_key"
  ON "print_templates"("tenant_id", (coalesce("branch_id", '')), "doc_type")
  WHERE "retired_at" IS NULL;

-- (1) and (6) hospital settings: default paper for new documents and the automatic patient card
ALTER TABLE "opd_settings"
  ADD COLUMN "default_print_paper" TEXT NOT NULL DEFAULT 'A5',
  ADD COLUMN "patient_card_auto_print" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "opd_settings_default_print_paper_chk" CHECK ("default_print_paper" IN ('A4', 'A5'));

-- (2) symptoms typed by reception while billing; editable until the doctor starts
ALTER TABLE "opd_visits"
  ADD COLUMN "reception_symptoms" TEXT,
  ADD CONSTRAINT "opd_visits_reception_symptoms_chk" CHECK (
    "reception_symptoms" IS NULL OR (length(btrim("reception_symptoms")) >= 1 AND length("reception_symptoms") <= 500)
  );

CREATE OR REPLACE FUNCTION opd_visits_symptoms_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.consultation_started_at IS NOT NULL
     AND NEW.reception_symptoms IS DISTINCT FROM OLD.reception_symptoms THEN
    RAISE EXCEPTION 'the symptoms entered by reception cannot change once the doctor has started'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opd_visits_symptoms_guard BEFORE UPDATE ON opd_visits
  FOR EACH ROW EXECUTE FUNCTION opd_visits_symptoms_guard();

GRANT UPDATE ("reception_symptoms") ON TABLE opd_visits TO hospigo_app;
