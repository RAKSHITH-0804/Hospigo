-- Step 7c: the details a doctor prints on a prescription, and the copy kept on a completed note.
--
-- doctor_profiles: how the name prints, qualifications, speciality, medical council registration
-- number. All optional; the department column already exists. The medical council name is NOT here
-- yet (waiting for management).
-- consultations.doctor_details: a copy of those details (plus the login name and department), taken
-- BY THE DATABASE at the moment the note is completed. The app cannot write this column (no UPDATE
-- grant) and the insert trigger clears it, so an old prescription never changes when a doctor edits
-- their profile later. Notes completed before this step have no copy: they show the live profile.

ALTER TABLE "doctor_profiles"
  ADD COLUMN "printed_name" TEXT,
  ADD COLUMN "qualifications" TEXT,
  ADD COLUMN "speciality" TEXT,
  ADD COLUMN "registration_no" TEXT;

ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_details_chk" CHECK (
  ("printed_name" IS NULL OR char_length("printed_name") BETWEEN 1 AND 80)
  AND ("qualifications" IS NULL OR char_length("qualifications") BETWEEN 1 AND 150)
  AND ("speciality" IS NULL OR char_length("speciality") BETWEEN 1 AND 80)
  AND ("registration_no" IS NULL OR char_length("registration_no") BETWEEN 1 AND 40)
);

ALTER TABLE "consultations" ADD COLUMN "doctor_details" JSONB;

-- A note always starts as a draft without a copy.
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
  NEW.doctor_details := NULL;
  RETURN NEW;
END;
$$;

-- Completing a note takes the copy of the doctor's details from the profile, here, not in the app.
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
    SELECT jsonb_build_object(
             'name', u.display_name,
             'printedName', d.printed_name,
             'department', d.department,
             'qualifications', d.qualifications,
             'speciality', d.speciality,
             'registrationNo', d.registration_no
           )
      INTO NEW.doctor_details
      FROM doctor_profiles d
      JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.user_id
     WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.doctor_profile_id;
  END IF;
  RETURN NEW;
END;
$$;
