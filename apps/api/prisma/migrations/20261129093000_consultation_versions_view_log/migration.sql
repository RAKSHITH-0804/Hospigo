-- Step 2.1b: (4) versions of a completed consultation, (5) the log of doctor views of a patient.

-- ------------------------------------------------------------------ consultation versions
-- A completed note is frozen. An Admin changes it by adding a VERSION (who, when, a required reason).
-- The original stays in "consultations"; every version holds the whole text as it became.
CREATE TABLE "consultation_versions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "consultation_id" TEXT NOT NULL,
  "visit_id" TEXT NOT NULL,
  "version_no" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "edited_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consultation_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consultation_versions_no_chk" CHECK ("version_no" >= 1),
  CONSTRAINT "consultation_versions_reason_chk" CHECK (
    length(btrim("reason")) >= 3 AND length("reason") <= 500
  ),
  CONSTRAINT "consultation_versions_snapshot_chk" CHECK (
    jsonb_typeof("snapshot") = 'object' AND octet_length("snapshot"::text) <= 60000
  ),
  CONSTRAINT "consultation_versions_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "consultation_versions_consultation_fkey" FOREIGN KEY ("tenant_id", "consultation_id", "visit_id", "branch_id")
    REFERENCES "consultations"("tenant_id", "id", "visit_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "consultation_versions_editor_fkey" FOREIGN KEY ("tenant_id", "edited_by")
    REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "consultation_versions_number_key" ON "consultation_versions" ("tenant_id", "consultation_id", "version_no");
CREATE INDEX "consultation_versions_visit_idx" ON "consultation_versions" ("tenant_id", "visit_id");

-- ------------------------------------------------------------------ the log of doctor views
-- One row when a doctor opens a patient they have no open visit with (at most one per doctor,
-- patient and hour, kept by the application). Ids only, no text.
CREATE TABLE "patient_view_log" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "viewer_user_id" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_view_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_view_log_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_view_log_branch_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_view_log_viewer_fkey" FOREIGN KEY ("tenant_id", "viewer_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_view_log_patient_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "patient_view_log_patient_idx" ON "patient_view_log" ("tenant_id", "patient_id", "created_at" DESC);
CREATE INDEX "patient_view_log_viewer_idx" ON "patient_view_log" ("tenant_id", "viewer_user_id", "patient_id", "created_at" DESC);

-- ------------------------------------------------------------------ RLS, grants, append-only
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consultation_versions', 'patient_view_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO hospigo_app USING (tenant_id = current_setting(''app.tenant_id'', true))',
      t || '_app_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO hospigo_app WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t || '_app_insert', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE %I TO hospigo_app', t);
    EXECUTE format('GRANT ALL ON TABLE %I TO hospigo_owner', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION refuse_indigo_log_mutation()',
      t || '_refuse_change', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION refuse_indigo_log_mutation()',
      t || '_refuse_truncate', t);
  END LOOP;
END $$;
