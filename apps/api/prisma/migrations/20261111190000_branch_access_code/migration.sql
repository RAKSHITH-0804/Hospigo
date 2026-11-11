-- Branch access codes (globally unique, case-insensitive).
-- Backfill: Main Branch inherits the hospital's current access_code;
-- other branches get a unique placeholder (dev/test data only — document in CHANGELOG).

ALTER TABLE "branches" ADD COLUMN "access_code" TEXT;

UPDATE "branches" AS b
SET "access_code" = h."access_code"
FROM "hospitals" AS h
WHERE b."tenant_id" = h."id"
  AND b."is_main" = true
  AND b."access_code" IS NULL;

UPDATE "branches"
SET "access_code" = 'dev-placeholder-' || lower("id")
WHERE "access_code" IS NULL;

ALTER TABLE "branches" ALTER COLUMN "access_code" SET NOT NULL;

CREATE UNIQUE INDEX "branches_access_code_normalized_uidx"
  ON "branches" (lower(trim("access_code")));
