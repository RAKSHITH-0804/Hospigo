-- Phase 2 Step 3c API: list index, field sections, always-required phone + date_of_birth.

-- List newest/oldest: (tenant_id, created_at, id).
CREATE INDEX "patients_tenant_id_created_at_id_idx"
  ON "patients" ("tenant_id", "created_at", "id");

-- Form section catalog (built-ins + customs).
CREATE TYPE "patient_field_section" AS ENUM (
  'PERSONAL',
  'CONTACT',
  'ADDRESS',
  'RELATIVE',
  'OTHER'
);

ALTER TABLE "patient_field_catalog"
  ADD COLUMN "default_section" "patient_field_section" NOT NULL DEFAULT 'OTHER';

ALTER TABLE "patient_custom_fields"
  ADD COLUMN "section" "patient_field_section" NOT NULL DEFAULT 'OTHER';

-- Built-in default sections + always-required name/phone/date_of_birth (cannot disable).
UPDATE "patient_field_catalog" SET
  "default_section" = 'PERSONAL',
  "always_required" = true,
  "can_disable" = false
WHERE "key" = 'name';

UPDATE "patient_field_catalog" SET
  "default_section" = 'PERSONAL',
  "always_required" = false,
  "can_disable" = true
WHERE "key" = 'gender';

UPDATE "patient_field_catalog" SET
  "default_section" = 'PERSONAL',
  "always_required" = true,
  "can_disable" = false
WHERE "key" = 'date_of_birth';

UPDATE "patient_field_catalog" SET
  "default_section" = 'CONTACT',
  "always_required" = true,
  "can_disable" = false
WHERE "key" = 'phone';

UPDATE "patient_field_catalog" SET
  "default_section" = 'CONTACT',
  "always_required" = false,
  "can_disable" = true
WHERE "key" = 'email';

UPDATE "patient_field_catalog" SET
  "default_section" = 'ADDRESS',
  "always_required" = false,
  "can_disable" = true
WHERE "key" IN (
  'address_street',
  'address_cross',
  'address_area',
  'address_city',
  'address_state',
  'address_pincode'
);

-- Existing hospital settings: force always-required builtins on and required.
UPDATE "patient_field_settings" AS s
SET
  "is_enabled" = true,
  "is_required" = true
FROM "patient_field_catalog" AS c
WHERE s."catalog_key" = c."key"
  AND c."always_required" = true;
