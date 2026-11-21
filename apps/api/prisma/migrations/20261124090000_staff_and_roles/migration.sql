-- Step 7d: staff and roles.
--
-- users.phone: an optional phone number a person can keep in My profile.
-- staff_code_settings: one row per hospital. The staff code (the short unique code of a user, for
-- example STF001) is made from a prefix and a running number with a minimum number of digits. The
-- hospital chooses the prefix and the digits; the counter only goes up, so a code is never reused.

ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_phone_chk"
  CHECK ("phone" IS NULL OR "phone" ~ '^[0-9+ ()-]{7,20}$');

CREATE TABLE "staff_code_settings" (
    "tenant_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'STF',
    "min_width" INTEGER NOT NULL DEFAULT 3,
    "last_number" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_code_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "staff_code_settings_prefix_chk" CHECK ("prefix" ~ '^[A-Za-z0-9]{1,6}$'),
    CONSTRAINT "staff_code_settings_width_chk" CHECK ("min_width" BETWEEN 1 AND 8),
    CONSTRAINT "staff_code_settings_last_chk" CHECK ("last_number" >= 0)
);

ALTER TABLE "staff_code_settings" ADD CONSTRAINT "staff_code_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "staff_code_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_code_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_code_settings_app_all ON staff_code_settings
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- hospigo_hq / hospigo_patient: intentionally NO grants.
GRANT SELECT, INSERT, UPDATE ON TABLE staff_code_settings TO hospigo_app;
GRANT ALL ON TABLE staff_code_settings TO hospigo_owner;
