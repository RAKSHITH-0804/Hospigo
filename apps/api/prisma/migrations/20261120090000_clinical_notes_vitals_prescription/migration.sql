-- Phase 2 Step 5a-2 and 5a-3: consultation note, addenda, vitals and prescription.
--
-- After reception takes payment the visit waits; the nurse records vitals; the doctor starts the
-- consultation, writes a note and a prescription and completes it. Clinical data is sensitive and
-- must never be silently rewritten, so the database itself enforces:
--   * one note per visit; it can only be created while the visit is IN_CONSULTATION and only for
--     the visit's own doctor; it starts as a DRAFT and ends as COMPLETED;
--   * a COMPLETED note is frozen (no update, no delete); a correction is an ADDENDUM (append-only,
--     with who, when and why) and only the visit's doctor can write one;
--   * a visit can become COMPLETED only after its note is COMPLETED (the old visit guard is
--     extended);
--   * prescription rows belong to one DRAFT note and are frozen with it; the medicine name is a
--     true copy of the medicines master (or the row is flagged "unlisted" free text);
--   * vitals are append-only; a correction is a NEW version with a reason, the latest version
--     counts; the unit and name are copied at write time (a later master change never rewrites
--     history); versions are gapless per visit and field;
--   * every table has forced row level security by hospital; hospigo_hq / hospigo_patient have NO
--     grants; same-hospital and same-branch composite foreign keys.
-- Who may call which route (doctor only for own visit, nurse of the branch, audit of reads) is the
-- API's job; nothing here relaxes any earlier protection.

-- ---------------------------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------------------------

CREATE TYPE "consultation_status" AS ENUM ('DRAFT', 'COMPLETED');

-- ---------------------------------------------------------------------------------------------
-- consultations
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "consultations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "status" "consultation_status" NOT NULL DEFAULT 'DRAFT',
    "complaints" TEXT,
    "diagnosis" TEXT,
    "advice" TEXT,
    "follow_up_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consultations_completed_chk" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
    -- A finished note says something: complaints or diagnosis must not be blank.
    CONSTRAINT "consultations_content_chk" CHECK (
      "status" = 'DRAFT'
      OR length(btrim(coalesce("complaints", ''))) > 0
      OR length(btrim(coalesce("diagnosis", ''))) > 0
    ),
    CONSTRAINT "consultations_length_chk" CHECK (
      length(coalesce("complaints", '')) <= 4000
      AND length(coalesce("diagnosis", '')) <= 4000
      AND length(coalesce("advice", '')) <= 4000
    )
);

CREATE UNIQUE INDEX "consultations_tenant_id_id_key" ON "consultations"("tenant_id", "id");
-- (id, visit, branch) together: children (addenda, prescription rows) must sit in the SAME visit
-- and the SAME branch as their note.
CREATE UNIQUE INDEX "consultations_tenant_id_id_visit_id_branch_id_key" ON "consultations"("tenant_id", "id", "visit_id", "branch_id");
CREATE UNIQUE INDEX "consultations_tenant_id_visit_id_key" ON "consultations"("tenant_id", "visit_id");
CREATE UNIQUE INDEX "consultations_tenant_id_visit_id_branch_id_key" ON "consultations"("tenant_id", "visit_id", "branch_id");
CREATE INDEX "consultations_doctor_idx" ON "consultations"("tenant_id", "doctor_profile_id", "status");

ALTER TABLE "consultations" ADD CONSTRAINT "consultations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_visit_fkey"
  FOREIGN KEY ("tenant_id", "visit_id", "branch_id") REFERENCES "opd_visits"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- consultation_addenda (append-only corrections of a completed note)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "consultation_addenda" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "consultation_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "addendum_text" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consultation_addenda_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consultation_addenda_text_chk" CHECK (
      length(btrim("addendum_text")) > 0 AND length("addendum_text") <= 4000
    ),
    CONSTRAINT "consultation_addenda_reason_chk" CHECK (
      length(btrim("reason")) > 0 AND length("reason") <= 500
    )
);

CREATE UNIQUE INDEX "consultation_addenda_tenant_id_id_key" ON "consultation_addenda"("tenant_id", "id");
CREATE INDEX "consultation_addenda_consultation_idx" ON "consultation_addenda"("tenant_id", "consultation_id", "created_at");

ALTER TABLE "consultation_addenda" ADD CONSTRAINT "consultation_addenda_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultation_addenda" ADD CONSTRAINT "consultation_addenda_consultation_fkey"
  FOREIGN KEY ("tenant_id", "consultation_id", "visit_id", "branch_id") REFERENCES "consultations"("tenant_id", "id", "visit_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultation_addenda" ADD CONSTRAINT "consultation_addenda_added_by_fkey"
  FOREIGN KEY ("tenant_id", "added_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- visit_vitals (append-only, versioned)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "visit_vitals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "vitals_field_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "field_code" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "value_kind" "vitals_value_kind" NOT NULL,
    "value_number" DECIMAL(10,2),
    "value_text" TEXT,
    "correction_reason" TEXT,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visit_vitals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visit_vitals_version_chk" CHECK ("version" >= 1),
    -- Exactly the value that matches the field kind: a number for NUMBER, text for TEXT.
    CONSTRAINT "visit_vitals_value_chk" CHECK (
      ("value_kind" = 'NUMBER' AND "value_number" IS NOT NULL AND "value_text" IS NULL)
      OR ("value_kind" = 'TEXT' AND "value_number" IS NULL
          AND length(btrim(coalesce("value_text", ''))) > 0 AND length("value_text") <= 200)
    ),
    -- Version 1 is the first reading; every later version is a correction and needs a reason.
    CONSTRAINT "visit_vitals_reason_chk" CHECK (
      "version" = 1
      OR (length(btrim(coalesce("correction_reason", ''))) > 0 AND length("correction_reason") <= 500)
    )
);

CREATE UNIQUE INDEX "visit_vitals_tenant_id_id_key" ON "visit_vitals"("tenant_id", "id");
CREATE UNIQUE INDEX "visit_vitals_version_key"
  ON "visit_vitals"("tenant_id", "visit_id", "vitals_field_id", "version");
CREATE INDEX "visit_vitals_visit_idx" ON "visit_vitals"("tenant_id", "visit_id");

ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_visit_fkey"
  FOREIGN KEY ("tenant_id", "visit_id", "branch_id") REFERENCES "opd_visits"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_field_fkey"
  FOREIGN KEY ("tenant_id", "vitals_field_id") REFERENCES "vitals_fields"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_vitals" ADD CONSTRAINT "visit_vitals_recorded_by_fkey"
  FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- prescription_items (rows of one DRAFT note; frozen with it)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "prescription_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "consultation_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "medicine_id" TEXT,
    "medicine_name" TEXT NOT NULL,
    "is_unlisted" BOOLEAN NOT NULL,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prescription_items_line_chk" CHECK ("line_no" >= 1),
    -- A medicine from the master has an id; free text has none and is flagged "unlisted".
    CONSTRAINT "prescription_items_listed_chk" CHECK (("medicine_id" IS NULL) = "is_unlisted"),
    CONSTRAINT "prescription_items_text_chk" CHECK (
      length(btrim("medicine_name")) > 0 AND length("medicine_name") <= 200
      AND length(btrim("dose")) > 0 AND length("dose") <= 100
      AND length(btrim("frequency")) > 0 AND length("frequency") <= 100
      AND length(btrim("duration")) > 0 AND length("duration") <= 100
      AND length(coalesce("instructions", '')) <= 500
    )
);

CREATE UNIQUE INDEX "prescription_items_tenant_id_id_key" ON "prescription_items"("tenant_id", "id");
CREATE UNIQUE INDEX "prescription_items_line_key" ON "prescription_items"("tenant_id", "consultation_id", "line_no");
CREATE INDEX "prescription_items_visit_idx" ON "prescription_items"("tenant_id", "visit_id");

ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_consultation_fkey"
  FOREIGN KEY ("tenant_id", "consultation_id", "visit_id", "branch_id") REFERENCES "consultations"("tenant_id", "id", "visit_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medicine_fkey"
  FOREIGN KEY ("tenant_id", "medicine_id") REFERENCES "medicines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row level security (tenant), grants
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "consultations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "consultation_addenda" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultation_addenda" FORCE ROW LEVEL SECURITY;
ALTER TABLE "visit_vitals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_vitals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "prescription_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescription_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY consultations_app_all ON consultations
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY consultation_addenda_app_all ON consultation_addenda
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY visit_vitals_app_all ON visit_vitals
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY prescription_items_app_all ON prescription_items
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- hospigo_hq / hospigo_patient: intentionally NO grants. The app role can only change the text
-- columns and the status of a note; everything else is insert-only (prescription rows may also be
-- deleted, but only while their note is a draft, see the triggers).
GRANT SELECT, INSERT ON TABLE consultations TO hospigo_app;
GRANT UPDATE ("status", "complaints", "diagnosis", "advice", "follow_up_date", "completed_at", "updated_at")
  ON TABLE consultations TO hospigo_app;
GRANT SELECT, INSERT ON TABLE consultation_addenda, visit_vitals TO hospigo_app;
GRANT SELECT, INSERT, DELETE ON TABLE prescription_items TO hospigo_app;
GRANT ALL ON TABLE consultations, consultation_addenda, visit_vitals, prescription_items TO hospigo_owner;

-- ---------------------------------------------------------------------------------------------
-- Append-only and delete / truncate protection (reuses the Step 2 functions)
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER consultations_refuse_delete BEFORE DELETE ON consultations
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER consultations_refuse_truncate BEFORE TRUNCATE ON consultations
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER consultation_addenda_refuse_update BEFORE UPDATE ON consultation_addenda
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER consultation_addenda_refuse_delete BEFORE DELETE ON consultation_addenda
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER consultation_addenda_refuse_truncate BEFORE TRUNCATE ON consultation_addenda
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER visit_vitals_refuse_update BEFORE UPDATE ON visit_vitals
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER visit_vitals_refuse_delete BEFORE DELETE ON visit_vitals
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER visit_vitals_refuse_truncate BEFORE TRUNCATE ON visit_vitals
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER prescription_items_refuse_update BEFORE UPDATE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER prescription_items_refuse_truncate BEFORE TRUNCATE ON prescription_items
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- ---------------------------------------------------------------------------------------------
-- consultations: when a note may be created and how it may change
-- ---------------------------------------------------------------------------------------------
-- The visit row is locked FOR SHARE so the visit cannot move on (to COMPLETED) while the note is
-- being written.

CREATE OR REPLACE FUNCTION consultations_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v record;
BEGIN
  SELECT status, doctor_profile_id INTO v
    FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id FOR SHARE;
  IF NOT FOUND OR v.status <> 'IN_CONSULTATION' THEN
    RAISE EXCEPTION 'a note can only be started while the visit is in consultation' USING ERRCODE = '23514';
  END IF;
  IF v.doctor_profile_id <> NEW.doctor_profile_id THEN
    RAISE EXCEPTION 'a note belongs to the doctor of the visit' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'a note always starts as a draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultations_before_insert BEFORE INSERT ON consultations
  FOR EACH ROW EXECUTE FUNCTION consultations_before_insert();

CREATE OR REPLACE FUNCTION consultations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF (NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.doctor_profile_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.doctor_profile_id, OLD.created_at) THEN
    RAISE EXCEPTION 'consultation identity columns are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'a completed note cannot be changed (write an addendum)' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'COMPLETED' THEN
    SELECT status::text INTO v_status
      FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'IN_CONSULTATION' THEN
      RAISE EXCEPTION 'a note can only be completed while the visit is in consultation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultations_guard BEFORE UPDATE ON consultations
  FOR EACH ROW EXECUTE FUNCTION consultations_guard();

-- ---------------------------------------------------------------------------------------------
-- addenda: only on a COMPLETED note, only by the visit's own doctor
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION consultation_addenda_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  c record;
BEGIN
  SELECT c0.status::text AS status, d.user_id AS doctor_user_id INTO c
    FROM consultations c0
    JOIN doctor_profiles d ON d.tenant_id = c0.tenant_id AND d.id = c0.doctor_profile_id
   WHERE c0.tenant_id = NEW.tenant_id AND c0.id = NEW.consultation_id
   FOR SHARE OF c0;
  IF NOT FOUND OR c.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'an addendum can only be added to a completed note' USING ERRCODE = '23514';
  END IF;
  IF c.doctor_user_id <> NEW.added_by THEN
    RAISE EXCEPTION 'only the doctor of the visit can add an addendum' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultation_addenda_before_insert BEFORE INSERT ON consultation_addenda
  FOR EACH ROW EXECUTE FUNCTION consultation_addenda_before_insert();

-- ---------------------------------------------------------------------------------------------
-- vitals: open visits only, a true copy of the master, gapless versions
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION visit_vitals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  f record;
  v_latest integer;
BEGIN
  SELECT status::text INTO v_status
    FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id FOR SHARE;
  IF v_status IS NULL OR v_status NOT IN ('WAITING', 'IN_CONSULTATION', 'COMPLETED') THEN
    RAISE EXCEPTION 'vitals can only be recorded for a visit that has joined the queue' USING ERRCODE = '23514';
  END IF;

  SELECT code, name, unit, value_kind INTO f
    FROM vitals_fields WHERE tenant_id = NEW.tenant_id AND id = NEW.vitals_field_id;
  IF NOT FOUND
     OR (f.code, f.name, f.unit, f.value_kind) IS DISTINCT FROM
        (NEW.field_code, NEW.field_name, NEW.unit, NEW.value_kind) THEN
    RAISE EXCEPTION 'vitals must carry a true copy of the field definition' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(max(version), 0) INTO v_latest FROM visit_vitals
   WHERE tenant_id = NEW.tenant_id AND visit_id = NEW.visit_id AND vitals_field_id = NEW.vitals_field_id;
  IF NEW.version <> v_latest + 1 THEN
    RAISE EXCEPTION 'a vitals version must follow the latest one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visit_vitals_before_insert BEFORE INSERT ON visit_vitals
  FOR EACH ROW EXECUTE FUNCTION visit_vitals_before_insert();

-- ---------------------------------------------------------------------------------------------
-- prescription: only while the note is a DRAFT; the medicine name is a true copy of the master
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prescription_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant text;
  v_consultation text;
  v_status text;
  v_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
    v_consultation := OLD.consultation_id;
  ELSE
    v_tenant := NEW.tenant_id;
    v_consultation := NEW.consultation_id;
  END IF;

  -- FOR SHARE: a note being completed (row lock) makes this wait, then it sees COMPLETED.
  SELECT status::text INTO v_status
    FROM consultations WHERE tenant_id = v_tenant AND id = v_consultation FOR SHARE;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'the prescription of a completed note cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.medicine_id IS NOT NULL THEN
    SELECT name INTO v_name FROM medicines WHERE tenant_id = NEW.tenant_id AND id = NEW.medicine_id;
    IF v_name IS DISTINCT FROM NEW.medicine_name THEN
      RAISE EXCEPTION 'the medicine name must be a true copy of the medicines list' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER prescription_items_guard BEFORE INSERT OR DELETE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION prescription_items_guard();

-- ---------------------------------------------------------------------------------------------
-- Visit guard: the Step 4a guard plus ONE new rule. A visit becomes COMPLETED only after its
-- consultation note is COMPLETED. (Everything else below is copied unchanged.)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION opd_visits_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.doctor_profile_id, NEW.visit_type,
      NEW.visit_date, NEW.previous_visit_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.doctor_profile_id, OLD.visit_type,
      OLD.visit_date, OLD.previous_visit_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'opd_visits identity columns are immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a % visit cannot be changed', OLD.status USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'AWAITING_PAYMENT' AND NEW.status IN ('WAITING', 'CANCELLED'))
    OR (OLD.status = 'WAITING' AND NEW.status IN ('IN_CONSULTATION', 'CANCELLED'))
    OR (OLD.status = 'IN_CONSULTATION' AND NEW.status = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'visit status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  -- Write-once columns: the token, queue time and consultation start never change after being set.
  IF OLD.token_no IS NOT NULL AND
     (NEW.token_no IS DISTINCT FROM OLD.token_no OR NEW.token_date IS DISTINCT FROM OLD.token_date) THEN
    RAISE EXCEPTION 'the token of a visit cannot change' USING ERRCODE = '23514';
  END IF;
  IF OLD.queued_at IS NOT NULL AND NEW.queued_at IS DISTINCT FROM OLD.queued_at THEN
    RAISE EXCEPTION 'queued_at cannot change' USING ERRCODE = '23514';
  END IF;
  IF OLD.consultation_started_at IS NOT NULL
     AND NEW.consultation_started_at IS DISTINCT FROM OLD.consultation_started_at THEN
    RAISE EXCEPTION 'consultation_started_at cannot change' USING ERRCODE = '23514';
  END IF;

  -- Queue gate: only a visit whose consultation bill is PAID (a zero total counts) may wait.
  IF OLD.status = 'AWAITING_PAYMENT' AND NEW.status = 'WAITING' THEN
    IF NOT EXISTS (
      SELECT 1 FROM bills b
      WHERE b.tenant_id = NEW.tenant_id AND b.visit_id = NEW.id
        AND b.bill_type = 'CONSULTATION' AND b.payment_status = 'PAID'
    ) THEN
      RAISE EXCEPTION 'a visit cannot join the queue before its consultation bill is paid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- NEW (5a-2): completing a visit needs a completed consultation note.
  IF OLD.status = 'IN_CONSULTATION' AND NEW.status = 'COMPLETED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM consultations c
      WHERE c.tenant_id = NEW.tenant_id AND c.visit_id = NEW.id AND c.status = 'COMPLETED'
    ) THEN
      RAISE EXCEPTION 'a visit cannot be completed before its consultation note is completed'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
