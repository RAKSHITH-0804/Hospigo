-- Step 8c: extra print values.
--
-- A named piece of plain text (for example "NABH number" or "Helpline") that the Admin defines once and
-- can then insert into a print template of the registration slip, receipt or prescription. It belongs to
-- the whole hospital (branch_id empty) or to one branch (a branch value with the same key replaces the
-- hospital one for that branch). It is TEXT ONLY: no HTML, no formulas, no scripts, no control
-- characters. A value is never deleted, only switched off (templates that use it print nothing for it).

CREATE TABLE "print_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_values_pkey" PRIMARY KEY ("id"),
    -- the key is a lower-case code, 1 to 30 characters, starting with a letter
    CONSTRAINT "print_values_key_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,29}$'),
    -- plain text only: no control characters (no line breaks), no angle brackets (no HTML), and none of
    -- the invisible direction and zero-width characters that could make a printed text read differently
    -- from what was typed (U+200B to U+200F, U+202A to U+202E, U+2066 to U+2069, U+FEFF)
    CONSTRAINT "print_values_label_chk" CHECK (
      length(btrim("label")) >= 1 AND length("label") <= 60
      AND "label" !~ '[[:cntrl:]<>\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]'
    ),
    CONSTRAINT "print_values_value_chk" CHECK (
      length(btrim("value")) >= 1 AND length("value") <= 200
      AND "value" !~ '[[:cntrl:]<>\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]'
    )
);

CREATE UNIQUE INDEX "print_values_tenant_id_id_key" ON "print_values"("tenant_id", "id");
-- One value per hospital-wide or per-branch scope and key.
CREATE UNIQUE INDEX "print_values_scope_key_key"
  ON "print_values"("tenant_id", (coalesce("branch_id", '')), "key");
CREATE INDEX "print_values_tenant_id_branch_id_idx" ON "print_values"("tenant_id", "branch_id");

ALTER TABLE "print_values" ADD CONSTRAINT "print_values_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_values" ADD CONSTRAINT "print_values_branch_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_values" ADD CONSTRAINT "print_values_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_values" ADD CONSTRAINT "print_values_updated_by_fkey"
  FOREIGN KEY ("tenant_id", "updated_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security: a hospital sees only its own values (forced, the owner login too).
ALTER TABLE "print_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_values" FORCE ROW LEVEL SECURITY;
CREATE POLICY print_values_app_all ON print_values
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Grants: read, add, and change only the text columns and the switch. No DELETE. hospigo_hq and
-- hospigo_patient get nothing.
GRANT SELECT, INSERT ON TABLE print_values TO hospigo_app;
GRANT UPDATE ("label", "value", "active", "updated_by", "updated_at") ON TABLE print_values TO hospigo_app;
GRANT ALL ON TABLE print_values TO hospigo_owner;

-- A value is never deleted or emptied (every login, the owner included): it is switched off instead.
CREATE TRIGGER print_values_refuse_delete
  BEFORE DELETE ON print_values
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER print_values_refuse_truncate
  BEFORE TRUNCATE ON print_values
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- The identity of a value never changes (hospital, branch, key, creator, creation time).
CREATE OR REPLACE FUNCTION print_values_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.key, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.key, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'print value identity columns are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER print_values_guard_update BEFORE UPDATE ON print_values
  FOR EACH ROW EXECUTE FUNCTION print_values_guard_update();
