-- Step 7e: pictures (the hospital logo and a doctor's signature or stamp).
--
-- The bytes live in object storage (never in the database); this table keeps WHAT the file is and
-- who may see it. A picture row is never changed except to stop being the current one, and never
-- deleted: a replaced or removed picture stays on record, so a completed prescription can keep
-- pointing at the signature it was signed with.
--   purpose HOSPITAL_LOGO    : one current logo per hospital (doctor_profile_id is empty)
--   purpose DOCTOR_SIGNATURE : one current picture per doctor profile

CREATE TABLE "stored_images" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "doctor_profile_id" TEXT,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stored_images_purpose_chk" CHECK ("purpose" IN ('HOSPITAL_LOGO', 'DOCTOR_SIGNATURE')),
    CONSTRAINT "stored_images_owner_chk" CHECK (("purpose" = 'DOCTOR_SIGNATURE') = ("doctor_profile_id" IS NOT NULL)),
    CONSTRAINT "stored_images_type_chk" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "stored_images_size_chk" CHECK ("byte_size" > 0 AND "width" > 0 AND "height" > 0),
    CONSTRAINT "stored_images_sha_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "stored_images_key_chk" CHECK (char_length("storage_key") BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX "stored_images_tenant_id_id_key" ON "stored_images"("tenant_id", "id");

-- At most one current picture for each place (the logo, or each doctor's signature).
CREATE UNIQUE INDEX "stored_images_one_current_idx"
  ON "stored_images"("tenant_id", "purpose", COALESCE("doctor_profile_id", ''))
  WHERE "is_current";

CREATE INDEX "stored_images_doctor_idx" ON "stored_images"("tenant_id", "doctor_profile_id")
  WHERE "doctor_profile_id" IS NOT NULL;

ALTER TABLE "stored_images" ADD CONSTRAINT "stored_images_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stored_images" ADD CONSTRAINT "stored_images_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stored_images" ADD CONSTRAINT "stored_images_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stored_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stored_images" FORCE ROW LEVEL SECURITY;
CREATE POLICY stored_images_app_all ON stored_images
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Only "is_current" may change: nothing else about a stored picture is ever edited, and no delete.
CREATE FUNCTION stored_images_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.purpose, NEW.doctor_profile_id, NEW.content_type, NEW.byte_size,
      NEW.width, NEW.height, NEW.sha256, NEW.storage_key, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.purpose, OLD.doctor_profile_id, OLD.content_type, OLD.byte_size,
      OLD.width, OLD.height, OLD.sha256, OLD.storage_key, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a stored picture cannot be edited' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stored_images_guard
  BEFORE UPDATE ON stored_images
  FOR EACH ROW EXECUTE FUNCTION stored_images_guard();

-- hospigo_hq / hospigo_patient: intentionally NO grants.
GRANT SELECT, INSERT ON TABLE stored_images TO hospigo_app;
GRANT UPDATE ("is_current") ON TABLE stored_images TO hospigo_app;
GRANT ALL ON TABLE stored_images TO hospigo_owner;

-- A completed note also keeps WHICH signature picture the doctor had at that moment.
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
             'registrationNo', d.registration_no,
             'signatureImageId', (
               SELECT s.id FROM stored_images s
                WHERE s.tenant_id = d.tenant_id AND s.doctor_profile_id = d.id
                  AND s.purpose = 'DOCTOR_SIGNATURE' AND s.is_current
             )
           )
      INTO NEW.doctor_details
      FROM doctor_profiles d
      JOIN users u ON u.tenant_id = d.tenant_id AND u.id = d.user_id
     WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.doctor_profile_id;
  END IF;
  RETURN NEW;
END;
$$;
