-- Step 3b-1 follow-up: UHID format configs/blocks are insert-once for hospigo_app.
-- A format change = a new config row + its own blocks. No UPDATE/DELETE for the app role.
-- Also revoke hard-DELETE on patient field customisation tables (archive via is_active / settings).

-- ---------------------------------------------------------------------------
-- 1) uhid_format_configs / uhid_format_blocks: SELECT + INSERT only for app
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS uhid_format_configs_app_all ON uhid_format_configs;
DROP POLICY IF EXISTS uhid_format_blocks_app_all ON uhid_format_blocks;

CREATE POLICY uhid_format_configs_app_select ON uhid_format_configs
  FOR SELECT TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY uhid_format_configs_app_insert ON uhid_format_configs
  FOR INSERT TO hospigo_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY uhid_format_blocks_app_select ON uhid_format_blocks
  FOR SELECT TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY uhid_format_blocks_app_insert ON uhid_format_blocks
  FOR INSERT TO hospigo_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

REVOKE UPDATE, DELETE ON TABLE uhid_format_configs, uhid_format_blocks FROM hospigo_app;
-- Keep SELECT, INSERT (already granted); re-assert for clarity.
GRANT SELECT, INSERT ON TABLE uhid_format_configs, uhid_format_blocks TO hospigo_app;

-- uhid_counters unchanged: SELECT, INSERT, UPDATE; no DELETE.

-- No UPDATE/DELETE-refusing trigger for ALL roles: owner fixtures run raw DELETE of a
-- FINANCIAL_YEAR block inside a transaction to assert the deferred validation raises
-- FINANCIAL_YEAR at COMMIT. A BEFORE DELETE immutability trigger for every role would
-- reject earlier with a different error and break that test. App immutability is
-- privilege + policy only.

-- ---------------------------------------------------------------------------
-- 2) Patient customisation tables: no hard DELETE for app (align with patients)
-- ---------------------------------------------------------------------------
REVOKE DELETE ON TABLE
  patient_custom_fields,
  patient_custom_field_options,
  patient_custom_field_values,
  patient_field_settings
FROM hospigo_app;

GRANT SELECT, INSERT, UPDATE ON TABLE
  patient_custom_fields,
  patient_custom_field_options,
  patient_custom_field_values,
  patient_field_settings
TO hospigo_app;
