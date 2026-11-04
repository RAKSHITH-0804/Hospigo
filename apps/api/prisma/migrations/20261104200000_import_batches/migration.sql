-- Step 3b-2: import batch bookkeeping (no Excel parsing).
-- import_types is a GLOBAL catalog (no tenant). Tenant tables below have FORCE RLS.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "import_batch_status" AS ENUM (
  'DRAFT', 'PREVIEWED', 'APPROVED', 'POSTED', 'UNDONE', 'FAILED'
);
CREATE TYPE "import_row_status" AS ENUM (
  'VALID', 'EXCEPTION', 'POSTED', 'REVERSED'
);
CREATE TYPE "import_row_action" AS ENUM (
  'CREATE', 'UPDATE', 'NONE'
);
CREATE TYPE "import_exception_status" AS ENUM (
  'OPEN', 'RESOLVED', 'DISMISSED'
);

-- ---------------------------------------------------------------------------
-- import_types (GLOBAL)
-- ---------------------------------------------------------------------------
CREATE TABLE "import_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_types_code_key" UNIQUE ("code")
);

GRANT SELECT ON TABLE "import_types" TO hospigo_app;
GRANT ALL ON TABLE "import_types" TO hospigo_owner;
-- hospigo_hq: no access

-- ---------------------------------------------------------------------------
-- import_batches (tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "import_type_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "status" "import_batch_status" NOT NULL DEFAULT 'DRAFT',
    "template_version" TEXT NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "file_storage_key" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "file_name_original" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "exception_rows" INTEGER NOT NULL DEFAULT 0,
    "posted_rows" INTEGER NOT NULL DEFAULT 0,
    "run_status" TEXT,
    "error_message" TEXT,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "posted_at" TIMESTAMPTZ(3),
    "undone_by" TEXT,
    "undone_at" TIMESTAMPTZ(3),
    "undo_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_batches_counts_nonneg_chk" CHECK (
      "total_rows" >= 0 AND "valid_rows" >= 0 AND "exception_rows" >= 0 AND "posted_rows" >= 0
    )
);

CREATE UNIQUE INDEX "import_batches_tenant_id_id_key"
  ON "import_batches"("tenant_id", "id");
CREATE INDEX "import_batches_tenant_id_status_idx"
  ON "import_batches"("tenant_id", "status");

-- Same file cannot be active twice; allowed again after UNDONE or FAILED.
CREATE UNIQUE INDEX "import_batches_active_file_uidx"
  ON "import_batches" (
    "tenant_id",
    "import_type_id",
    (COALESCE("branch_id", '')),
    "file_sha256"
  )
  WHERE "status" IN ('DRAFT', 'PREVIEWED', 'APPROVED', 'POSTED');

ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_import_type_id_fkey"
  FOREIGN KEY ("import_type_id") REFERENCES "import_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_approved_by_fkey"
  FOREIGN KEY ("tenant_id", "approved_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_undone_by_fkey"
  FOREIGN KEY ("tenant_id", "undone_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- import_batch_rows (tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE "import_batch_rows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "match_key" TEXT NOT NULL,
    -- raw_values: immutable copy of the source row for AUDIT and UNDO only.
    -- Never read by business / domain matching logic.
    "raw_values" JSONB NOT NULL,
    "row_status" "import_row_status" NOT NULL DEFAULT 'VALID',
    "action" "import_row_action",
    "result_entity_type" TEXT,
    "result_entity_id" TEXT,
    "previous_values" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_batch_rows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_batch_rows_row_number_pos_chk" CHECK ("row_number" >= 1)
);

CREATE UNIQUE INDEX "import_batch_rows_tenant_id_id_key"
  ON "import_batch_rows"("tenant_id", "id");
CREATE UNIQUE INDEX "import_batch_rows_batch_id_row_number_key"
  ON "import_batch_rows"("batch_id", "row_number");
CREATE INDEX "import_batch_rows_tenant_id_batch_id_idx"
  ON "import_batch_rows"("tenant_id", "batch_id");

ALTER TABLE "import_batch_rows" ADD CONSTRAINT "import_batch_rows_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_batch_rows" ADD CONSTRAINT "import_batch_rows_tenant_id_batch_id_fkey"
  FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "import_batches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- import_exceptions (tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE "import_exceptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "import_exception_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_exceptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_exceptions_resolved_fields_chk" CHECK (
      ("status" = 'OPEN' AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
      OR (
        "status" IN ('RESOLVED', 'DISMISSED')
        AND "resolved_by" IS NOT NULL
        AND "resolved_at" IS NOT NULL
        AND "resolution_note" IS NOT NULL
        AND length(btrim("resolution_note")) > 0
      )
    )
);

CREATE UNIQUE INDEX "import_exceptions_tenant_id_id_key"
  ON "import_exceptions"("tenant_id", "id");
CREATE INDEX "import_exceptions_tenant_id_batch_id_idx"
  ON "import_exceptions"("tenant_id", "batch_id");

ALTER TABLE "import_exceptions" ADD CONSTRAINT "import_exceptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_exceptions" ADD CONSTRAINT "import_exceptions_tenant_id_batch_id_fkey"
  FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "import_batches"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_exceptions" ADD CONSTRAINT "import_exceptions_tenant_id_row_id_fkey"
  FOREIGN KEY ("tenant_id", "row_id") REFERENCES "import_batch_rows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_exceptions" ADD CONSTRAINT "import_exceptions_tenant_id_resolved_by_fkey"
  FOREIGN KEY ("tenant_id", "resolved_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- State machine trigger on import_batches
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION import_batches_enforce_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Same-status SET is refused (no-op status updates are not allowed).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'import_batches: status no-op refused (already %)', OLD.status;
  END IF;

  -- Terminal states: no exit
  IF OLD.status IN ('UNDONE', 'FAILED') THEN
    RAISE EXCEPTION 'import_batches: status % is terminal; cannot move to %', OLD.status, NEW.status;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status IN ('PREVIEWED', 'FAILED') THEN
    NULL;
  ELSIF OLD.status = 'PREVIEWED' AND NEW.status IN ('APPROVED', 'FAILED') THEN
    NULL;
  ELSIF OLD.status = 'APPROVED' AND NEW.status IN ('POSTED', 'FAILED') THEN
    NULL;
  ELSIF OLD.status = 'POSTED' AND NEW.status = 'UNDONE' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'import_batches: illegal status transition % -> %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'APPROVED' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'import_batches: APPROVED requires approved_by and approved_at';
    END IF;
  END IF;

  IF NEW.status = 'POSTED' THEN
    IF OLD.approved_by IS NULL OR OLD.approved_at IS NULL THEN
      RAISE EXCEPTION 'import_batches: POSTED requires an earlier approval';
    END IF;
  END IF;

  IF NEW.status = 'UNDONE' THEN
    IF NEW.undone_by IS NULL OR NEW.undone_at IS NULL
       OR NEW.undo_reason IS NULL OR length(btrim(NEW.undo_reason)) = 0 THEN
      RAISE EXCEPTION 'import_batches: UNDONE requires undone_by, undone_at and undo_reason';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER import_batches_status_transition_trg
  BEFORE UPDATE OF status ON import_batches
  FOR EACH ROW
  EXECUTE FUNCTION import_batches_enforce_status_transition();

-- ---------------------------------------------------------------------------
-- Immutable raw_values + row_number on import_batch_rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION import_batch_rows_refuse_raw_mutate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.row_number IS DISTINCT FROM OLD.row_number THEN
    RAISE EXCEPTION 'import_batch_rows: row_number is immutable after insert';
  END IF;
  IF NEW.raw_values IS DISTINCT FROM OLD.raw_values THEN
    RAISE EXCEPTION 'import_batch_rows: raw_values is immutable after insert (audit copy only)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_batch_rows_refuse_raw_mutate_trg
  BEFORE UPDATE ON import_batch_rows
  FOR EACH ROW
  EXECUTE FUNCTION import_batch_rows_refuse_raw_mutate();

-- ---------------------------------------------------------------------------
-- RLS + grants (tenant tables)
-- ---------------------------------------------------------------------------
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_batch_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_batch_rows" FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_exceptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY import_batches_app_select ON import_batches
  FOR SELECT TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY import_batches_app_insert ON import_batches
  FOR INSERT TO hospigo_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY import_batches_app_update ON import_batches
  FOR UPDATE TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY import_batch_rows_app_select ON import_batch_rows
  FOR SELECT TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY import_batch_rows_app_insert ON import_batch_rows
  FOR INSERT TO hospigo_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY import_batch_rows_app_update ON import_batch_rows
  FOR UPDATE TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY import_exceptions_app_select ON import_exceptions
  FOR SELECT TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY import_exceptions_app_insert ON import_exceptions
  FOR INSERT TO hospigo_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY import_exceptions_app_update ON import_exceptions
  FOR UPDATE TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON TABLE
  import_batches, import_batch_rows, import_exceptions
TO hospigo_app;
GRANT ALL ON TABLE
  import_batches, import_batch_rows, import_exceptions
TO hospigo_owner;
-- hospigo_hq: no access to any import table
