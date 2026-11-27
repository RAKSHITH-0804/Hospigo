-- Phase 2.2 (checkpoint 1): HQ never enters a hospital. The Indigo entry is gone from the code; this
-- migration switches off what it left behind in existing databases. Nothing here weakens row level
-- security, and the append-only table "indigo_access_log" is left as it is (unused, still append-only).
-- The trigger "users_indigo_flag_guard" stays: with the entry gone nobody can create a flagged user.

-- 1. Old hidden users (one per HQ person who entered a hospital): switched off, their sign-in
--    sessions ended, their role assignments switched off. Nothing is deleted.
UPDATE "auth_sessions" SET "revoked_at" = now()
  WHERE "revoked_at" IS NULL
    AND "user_id" IN (SELECT "id" FROM "users" WHERE "indigo_hq_user_id" IS NOT NULL);
UPDATE "role_assignments" SET "is_active" = false
  WHERE "is_active"
    AND "user_id" IN (SELECT "id" FROM "users" WHERE "indigo_hq_user_id" IS NOT NULL);
UPDATE "users" SET "is_active" = false
  WHERE "is_active" AND "indigo_hq_user_id" IS NOT NULL;

-- 2. The roles TENANT_ADMIN and INDIGO_EMPLOYEE no longer exist: assignments and grants switched off,
--    the roles switched off (rows stay so history keeps pointing at something).
UPDATE "role_assignments" SET "is_active" = false
  WHERE "is_active"
    AND "role_id" IN (SELECT "id" FROM "roles" WHERE "code" IN ('TENANT_ADMIN', 'INDIGO_EMPLOYEE'));
UPDATE "role_permissions" SET "is_active" = false
  WHERE "is_active"
    AND "role_id" IN (SELECT "id" FROM "roles" WHERE "code" IN ('TENANT_ADMIN', 'INDIGO_EMPLOYEE'));
UPDATE "roles" SET "is_active" = false
  WHERE "is_active" AND "code" IN ('TENANT_ADMIN', 'INDIGO_EMPLOYEE');

-- 3. The permission of the removed "Indigo access" screen: switched off everywhere.
UPDATE "role_permissions" SET "is_active" = false
  WHERE "is_active"
    AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" = 'indigo.access.read');
UPDATE "permissions" SET "is_active" = false WHERE "code" = 'indigo.access.read';
