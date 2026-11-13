-- Remove hospital-level access codes and the old lookup helper.

DROP FUNCTION IF EXISTS lookup_hospital_id_by_access_code(text);

DROP INDEX IF EXISTS "hospitals_access_code_normalized_uidx";
DROP INDEX IF EXISTS "hospitals_access_code_key";

ALTER TABLE "hospitals" DROP COLUMN IF EXISTS "access_code";
