-- Phase 2 Step 4a: OPD visits and money (bills, lines, payments, ledger, registration fee).
--
-- The database refuses wrong money so no API bug can create it:
--   * bill_lines, payments, ledger_entries are append-only (UPDATE/DELETE/TRUNCATE refused, owner too);
--   * bills never change except paid_paise / refunded_paise / payment_status, and those only
--     through the ledger trigger (the app role has no UPDATE on bills at all);
--   * ledger_entries are written ONLY by triggers (the app role has no INSERT);
--   * a payment can never exceed the amount due (row lock + check), even under parallel requests;
--   * a bill must equal the sum of its lines at commit;
--   * the registration fee is charged once per patient across all branches;
--   * a visit can enter the queue only when its consultation bill is PAID (zero total counts);
--   * counters (number_series, token_counters) can never go backwards.
-- Every table has FORCE row level security by tenant. hospigo_hq / hospigo_patient: NO grants.
-- Part payment, refunds, investigations, Emergency and clinical tables arrive in later steps
-- (plain ADD COLUMN / new tables); enums are written in full so they need no change.

CREATE TYPE "visit_status" AS ENUM (
  'AWAITING_PAYMENT', 'WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED'
);
CREATE TYPE "bill_type" AS ENUM ('CONSULTATION', 'INVESTIGATION');
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PART_PAID', 'PAID');
CREATE TYPE "ledger_entry_type" AS ENUM ('CHARGE', 'PAYMENT', 'REFUND', 'CHARGE_REVERSAL');

-- Hospital setting: a repeat visit with the SAME doctor inside this many hours of the last PAID
-- consultation collects no consultation money. 0 = off (default). Set by Admin (screen: Step 7b).
ALTER TABLE "opd_settings" ADD COLUMN "repeat_visit_free_hours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "opd_settings" ADD CONSTRAINT "opd_settings_repeat_free_chk"
  CHECK ("repeat_visit_free_hours" >= 0 AND "repeat_visit_free_hours" <= 8760);

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "opd_visits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "visit_type" "visit_type" NOT NULL,
    "visit_date" DATE NOT NULL,
    "status" "visit_status" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "previous_visit_id" TEXT,
    "token_date" DATE,
    "token_no" INTEGER,
    "queued_at" TIMESTAMPTZ(3),
    "consultation_started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "opd_visits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opd_visits_token_pair_chk" CHECK (("token_date" IS NULL) = ("token_no" IS NULL)),
    CONSTRAINT "opd_visits_token_no_chk" CHECK ("token_no" IS NULL OR "token_no" > 0),
    CONSTRAINT "opd_visits_status_token_chk" CHECK (
      "status" IN ('AWAITING_PAYMENT', 'CANCELLED') OR "token_no" IS NOT NULL
    ),
    CONSTRAINT "opd_visits_status_queued_chk" CHECK (
      "status" IN ('AWAITING_PAYMENT', 'CANCELLED') OR "queued_at" IS NOT NULL
    ),
    CONSTRAINT "opd_visits_awaiting_clean_chk" CHECK (
      "status" <> 'AWAITING_PAYMENT'
      OR ("token_no" IS NULL AND "queued_at" IS NULL AND "consultation_started_at" IS NULL)
    ),
    CONSTRAINT "opd_visits_started_chk" CHECK (
      "status" NOT IN ('IN_CONSULTATION', 'COMPLETED') OR "consultation_started_at" IS NOT NULL
    ),
    CONSTRAINT "opd_visits_completed_chk" CHECK (
      ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    ),
    CONSTRAINT "opd_visits_cancelled_chk" CHECK (
      ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    ),
    CONSTRAINT "opd_visits_cancel_reason_chk" CHECK (
      "status" <> 'CANCELLED' OR length(btrim(coalesce("cancelled_reason", ''))) > 0
    ),
    CONSTRAINT "opd_visits_followup_link_chk" CHECK (
      "visit_type" = 'FOLLOW_UP' OR "previous_visit_id" IS NULL
    )
);

CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "bill_type" "bill_type" NOT NULL,
    "bill_number" TEXT NOT NULL,
    "bill_date" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal_paise" INTEGER NOT NULL,
    "tax_paise" INTEGER NOT NULL DEFAULT 0,
    "total_paise" INTEGER NOT NULL,
    "paid_paise" INTEGER NOT NULL DEFAULT 0,
    "refunded_paise" INTEGER NOT NULL DEFAULT 0,
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bills_amounts_chk" CHECK (
      "subtotal_paise" >= 0 AND "tax_paise" >= 0 AND "total_paise" >= 0
      AND "paid_paise" >= 0 AND "refunded_paise" >= 0
    ),
    CONSTRAINT "bills_total_chk" CHECK ("total_paise" = "subtotal_paise" + "tax_paise"),
    CONSTRAINT "bills_paid_le_total_chk" CHECK ("paid_paise" <= "total_paise"),
    CONSTRAINT "bills_refunded_le_paid_chk" CHECK ("refunded_paise" <= "paid_paise"),
    -- A zero-total bill (free follow-up) is settled. Otherwise the status follows paid_paise.
    CONSTRAINT "bills_status_chk" CHECK (
      ("total_paise" = 0 AND "payment_status" = 'PAID' AND "paid_paise" = 0)
      OR ("total_paise" > 0 AND (
        ("payment_status" = 'UNPAID' AND "paid_paise" = 0)
        OR ("payment_status" = 'PART_PAID' AND "paid_paise" > 0 AND "paid_paise" < "total_paise")
        OR ("payment_status" = 'PAID' AND "paid_paise" = "total_paise")
      ))
    ),
    CONSTRAINT "bills_key_chk" CHECK (
      length(btrim("bill_number")) > 0 AND length(btrim("idempotency_key")) > 0
    )
);

CREATE TABLE "bill_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "kind" "charge_item_kind" NOT NULL,
    "charge_item_id" TEXT,
    "doctor_fee_id" TEXT,
    "code_snapshot" TEXT NOT NULL,
    "description_snapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_paise" INTEGER NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_paise" INTEGER NOT NULL DEFAULT 0,
    "line_total_paise" INTEGER NOT NULL,
    "pricing_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_lines_line_no_chk" CHECK ("line_no" > 0),
    CONSTRAINT "bill_lines_quantity_chk" CHECK ("quantity" > 0),
    CONSTRAINT "bill_lines_amounts_chk" CHECK (
      "unit_price_paise" >= 0 AND "tax_paise" >= 0 AND "line_total_paise" >= 0
    ),
    CONSTRAINT "bill_lines_tax_rate_chk" CHECK ("tax_rate_bp" >= 0 AND "tax_rate_bp" <= 10000),
    CONSTRAINT "bill_lines_total_chk" CHECK (
      "line_total_paise"::bigint = "quantity"::bigint * "unit_price_paise"::bigint + "tax_paise"::bigint
    ),
    -- Exactly one price source: a charge item (registration, investigation) or a doctor fee.
    CONSTRAINT "bill_lines_source_chk" CHECK (("charge_item_id" IS NULL) <> ("doctor_fee_id" IS NULL)),
    CONSTRAINT "bill_lines_snapshot_chk" CHECK (
      length(btrim("code_snapshot")) > 0 AND length(btrim("description_snapshot")) > 0
    )
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "payment_mode_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reference_no" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_chk" CHECK ("amount_paise" > 0),
    CONSTRAINT "payments_key_chk" CHECK (
      length(btrim("receipt_number")) > 0 AND length(btrim("idempotency_key")) > 0
    )
);

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "entry_type" "ledger_entry_type" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "payment_id" TEXT,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_amount_chk" CHECK ("amount_paise" > 0),
    CONSTRAINT "ledger_entries_payment_link_chk" CHECK (
      ("entry_type" = 'PAYMENT') = ("payment_id" IS NOT NULL)
    )
);

CREATE TABLE "patient_registration_fees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "bill_line_id" TEXT NOT NULL,
    "charged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    CONSTRAINT "patient_registration_fees_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------------------------
-- Uniques and indexes
-- ---------------------------------------------------------------------------------------------

CREATE UNIQUE INDEX "opd_visits_tenant_id_id_key" ON "opd_visits"("tenant_id", "id");
CREATE UNIQUE INDEX "opd_visits_tenant_id_id_branch_id_key" ON "opd_visits"("tenant_id", "id", "branch_id");
-- One token per branch per day (token_no is set once the visit enters the queue).
CREATE UNIQUE INDEX "opd_visits_token_key"
  ON "opd_visits"("tenant_id", "branch_id", "token_date", "token_no") WHERE "token_no" IS NOT NULL;
CREATE INDEX "opd_visits_doctor_queue_idx"
  ON "opd_visits"("tenant_id", "branch_id", "doctor_profile_id", "status", "queued_at");
CREATE INDEX "opd_visits_followup_idx"
  ON "opd_visits"("tenant_id", "patient_id", "doctor_profile_id", "visit_date" DESC);
CREATE INDEX "opd_visits_patient_history_idx"
  ON "opd_visits"("tenant_id", "patient_id", "created_at" DESC);

CREATE UNIQUE INDEX "bills_tenant_id_id_key" ON "bills"("tenant_id", "id");
CREATE UNIQUE INDEX "bills_tenant_id_id_branch_id_key" ON "bills"("tenant_id", "id", "branch_id");
CREATE UNIQUE INDEX "bills_tenant_id_bill_number_key" ON "bills"("tenant_id", "bill_number");
CREATE UNIQUE INDEX "bills_tenant_id_idempotency_key_key" ON "bills"("tenant_id", "idempotency_key");
-- One consultation bill per visit.
CREATE UNIQUE INDEX "bills_one_consultation_per_visit_key"
  ON "bills"("tenant_id", "visit_id") WHERE "bill_type" = 'CONSULTATION';
CREATE INDEX "bills_branch_date_idx" ON "bills"("tenant_id", "branch_id", "bill_date");
CREATE INDEX "bills_pending_dues_idx"
  ON "bills"("tenant_id", "branch_id", "payment_status") WHERE "payment_status" <> 'PAID';

CREATE UNIQUE INDEX "bill_lines_tenant_id_id_key" ON "bill_lines"("tenant_id", "id");
CREATE UNIQUE INDEX "bill_lines_tenant_bill_line_no_key" ON "bill_lines"("tenant_id", "bill_id", "line_no");

CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");
CREATE UNIQUE INDEX "payments_tenant_id_receipt_number_key" ON "payments"("tenant_id", "receipt_number");
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");
CREATE INDEX "payments_bill_idx" ON "payments"("tenant_id", "bill_id");

CREATE UNIQUE INDEX "ledger_entries_tenant_id_id_key" ON "ledger_entries"("tenant_id", "id");
CREATE UNIQUE INDEX "ledger_entries_payment_key"
  ON "ledger_entries"("tenant_id", "payment_id") WHERE "payment_id" IS NOT NULL;
CREATE UNIQUE INDEX "ledger_entries_one_charge_key"
  ON "ledger_entries"("tenant_id", "bill_id") WHERE "entry_type" = 'CHARGE';
CREATE INDEX "ledger_entries_bill_idx" ON "ledger_entries"("tenant_id", "bill_id");

CREATE UNIQUE INDEX "patient_registration_fees_tenant_id_id_key"
  ON "patient_registration_fees"("tenant_id", "id");
-- Registration fee once per patient across ALL branches (until voided by a later refund step).
CREATE UNIQUE INDEX "patient_registration_fees_active_key"
  ON "patient_registration_fees"("tenant_id", "patient_id") WHERE "voided_at" IS NULL;
CREATE UNIQUE INDEX "patient_registration_fees_line_key"
  ON "patient_registration_fees"("tenant_id", "bill_line_id");

-- ---------------------------------------------------------------------------------------------
-- Foreign keys (money tables: a hospital with money rows can never be deleted -> RESTRICT)
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "opd_visits" ADD CONSTRAINT "opd_visits_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opd_visits" ADD CONSTRAINT "opd_visits_branch_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opd_visits" ADD CONSTRAINT "opd_visits_patient_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opd_visits" ADD CONSTRAINT "opd_visits_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opd_visits" ADD CONSTRAINT "opd_visits_previous_visit_fkey"
  FOREIGN KEY ("tenant_id", "previous_visit_id") REFERENCES "opd_visits"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opd_visits" ADD CONSTRAINT "opd_visits_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- The bill's branch must be the visit's branch.
ALTER TABLE "bills" ADD CONSTRAINT "bills_visit_fkey"
  FOREIGN KEY ("tenant_id", "visit_id", "branch_id") REFERENCES "opd_visits"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_fkey"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_fkey"
  FOREIGN KEY ("tenant_id", "bill_id") REFERENCES "bills"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_charge_item_fkey"
  FOREIGN KEY ("tenant_id", "charge_item_id") REFERENCES "charge_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_doctor_fee_fkey"
  FOREIGN KEY ("tenant_id", "doctor_fee_id") REFERENCES "doctor_fees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_fkey"
  FOREIGN KEY ("tenant_id", "bill_id", "branch_id") REFERENCES "bills"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_mode_fkey"
  FOREIGN KEY ("tenant_id", "payment_mode_id") REFERENCES "payment_modes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_fkey"
  FOREIGN KEY ("tenant_id", "received_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bill_fkey"
  FOREIGN KEY ("tenant_id", "bill_id", "branch_id") REFERENCES "bills"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_fkey"
  FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_registration_fees" ADD CONSTRAINT "patient_registration_fees_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_registration_fees" ADD CONSTRAINT "patient_registration_fees_patient_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_registration_fees" ADD CONSTRAINT "patient_registration_fees_line_fkey"
  FOREIGN KEY ("tenant_id", "bill_line_id") REFERENCES "bill_lines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row level security (tenant). FORCE: the owner login is bound too unless it has BYPASSRLS
-- (only the owner role has; the app role never does).
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "opd_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opd_visits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bill_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patient_registration_fees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_registration_fees" FORCE ROW LEVEL SECURITY;

CREATE POLICY opd_visits_app_all ON opd_visits
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY bills_app_all ON bills
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY bill_lines_app_all ON bill_lines
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY payments_app_all ON payments
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY ledger_entries_app_all ON ledger_entries
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY patient_registration_fees_app_all ON patient_registration_fees
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------------------------
-- Grants. hospigo_hq / hospigo_patient: intentionally NONE.
-- The app role can only INSERT/SELECT money tables, change a few visit columns, and cannot even
-- INSERT into the ledger (triggers do, as SECURITY DEFINER).
-- ---------------------------------------------------------------------------------------------

GRANT SELECT, INSERT ON TABLE opd_visits, bills, bill_lines, payments, patient_registration_fees TO hospigo_app;
GRANT UPDATE ("status", "token_date", "token_no", "queued_at", "consultation_started_at",
              "completed_at", "cancelled_at", "cancelled_reason", "updated_at")
  ON TABLE opd_visits TO hospigo_app;
GRANT SELECT ON TABLE ledger_entries TO hospigo_app;
GRANT ALL ON TABLE opd_visits, bills, bill_lines, payments, ledger_entries, patient_registration_fees
  TO hospigo_owner;

-- ---------------------------------------------------------------------------------------------
-- Helper: a SECURITY DEFINER trigger must never act on another hospital's rows (the definer
-- bypasses RLS). For the application login the session MUST carry a tenant and the row being
-- written must belong to it: an empty or missing tenant is refused too (otherwise error messages
-- from the trigger could describe another hospital's bill). Other logins (owner, migrations,
-- fixtures) are trusted and carry no tenant.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION opd_assert_tenant(p_tenant text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session text := nullif(current_setting('app.tenant_id', true), '');
BEGIN
  IF session_user = 'hospigo_app' THEN
    IF v_session IS NULL OR p_tenant IS DISTINCT FROM v_session THEN
      RAISE EXCEPTION 'tenant mismatch' USING ERRCODE = '42501';
    END IF;
  ELSIF v_session IS NOT NULL AND p_tenant IS DISTINCT FROM v_session THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Append-only and delete/truncate protection (reuses the Step 2 functions)
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER bill_lines_refuse_update BEFORE UPDATE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER bill_lines_refuse_delete BEFORE DELETE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER bill_lines_refuse_truncate BEFORE TRUNCATE ON bill_lines
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER payments_refuse_update BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER payments_refuse_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER payments_refuse_truncate BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER ledger_entries_refuse_update BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER ledger_entries_refuse_delete BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER ledger_entries_refuse_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- Bills, visits and registration-fee records are never deleted either.
CREATE TRIGGER bills_refuse_delete BEFORE DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER bills_refuse_truncate BEFORE TRUNCATE ON bills
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();
CREATE TRIGGER opd_visits_refuse_delete BEFORE DELETE ON opd_visits
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER opd_visits_refuse_truncate BEFORE TRUNCATE ON opd_visits
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();
CREATE TRIGGER patient_registration_fees_refuse_delete BEFORE DELETE ON patient_registration_fees
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER patient_registration_fees_refuse_truncate BEFORE TRUNCATE ON patient_registration_fees
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- ---------------------------------------------------------------------------------------------
-- Visits: start awaiting payment; guarded transitions; the queue gate
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION opd_visits_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev record;
BEGIN
  IF NEW.status <> 'AWAITING_PAYMENT' THEN
    RAISE EXCEPTION 'a visit starts as AWAITING_PAYMENT' USING ERRCODE = '23514';
  END IF;
  IF NEW.previous_visit_id IS NOT NULL THEN
    SELECT patient_id, status INTO v_prev FROM opd_visits
      WHERE tenant_id = NEW.tenant_id AND id = NEW.previous_visit_id;
    IF NOT FOUND OR v_prev.patient_id <> NEW.patient_id OR v_prev.status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'previous visit must be a completed visit of the same patient' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opd_visits_before_insert BEFORE INSERT ON opd_visits
  FOR EACH ROW EXECUTE FUNCTION opd_visits_before_insert();

CREATE OR REPLACE FUNCTION opd_visits_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.tenant_id, NEW.branch_id, NEW.patient_id, NEW.doctor_profile_id, NEW.visit_type,
      NEW.visit_date, NEW.previous_visit_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.branch_id, OLD.patient_id, OLD.doctor_profile_id, OLD.visit_type,
      OLD.visit_date, OLD.previous_visit_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'opd_visits identity columns are immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a % visit cannot be changed', OLD.status USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'AWAITING_PAYMENT' AND NEW.status IN ('WAITING', 'CANCELLED'))
    OR (OLD.status = 'WAITING' AND NEW.status IN ('IN_CONSULTATION', 'CANCELLED'))
    OR (OLD.status = 'IN_CONSULTATION' AND NEW.status = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'visit status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  -- Write-once columns: the token, queue time and consultation start never change after being set.
  IF OLD.token_no IS NOT NULL AND
     (NEW.token_no IS DISTINCT FROM OLD.token_no OR NEW.token_date IS DISTINCT FROM OLD.token_date) THEN
    RAISE EXCEPTION 'the token of a visit cannot change' USING ERRCODE = '23514';
  END IF;
  IF OLD.queued_at IS NOT NULL AND NEW.queued_at IS DISTINCT FROM OLD.queued_at THEN
    RAISE EXCEPTION 'queued_at cannot change' USING ERRCODE = '23514';
  END IF;
  IF OLD.consultation_started_at IS NOT NULL
     AND NEW.consultation_started_at IS DISTINCT FROM OLD.consultation_started_at THEN
    RAISE EXCEPTION 'consultation_started_at cannot change' USING ERRCODE = '23514';
  END IF;

  -- Queue gate: only a visit whose consultation bill is PAID (a zero total counts) may wait.
  IF OLD.status = 'AWAITING_PAYMENT' AND NEW.status = 'WAITING' THEN
    IF NOT EXISTS (
      SELECT 1 FROM bills b
      WHERE b.tenant_id = NEW.tenant_id AND b.visit_id = NEW.id
        AND b.bill_type = 'CONSULTATION' AND b.payment_status = 'PAID'
    ) THEN
      RAISE EXCEPTION 'a visit cannot join the queue before its consultation bill is paid'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opd_visits_guard BEFORE UPDATE ON opd_visits
  FOR EACH ROW EXECUTE FUNCTION opd_visits_guard();

-- ---------------------------------------------------------------------------------------------
-- Bills: created unpaid (or settled when the total is zero); only the ledger moves paid columns
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bills_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status visit_status;
BEGIN
  -- Nothing the caller sends for these columns is trusted.
  NEW.paid_paise := 0;
  NEW.refunded_paise := 0;
  NEW.payment_status := CASE WHEN NEW.total_paise = 0 THEN 'PAID' ELSE 'UNPAID' END::payment_status;

  IF NEW.bill_type = 'CONSULTATION' THEN
    SELECT status INTO v_status FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id;
    IF v_status IS DISTINCT FROM 'AWAITING_PAYMENT' THEN
      RAISE EXCEPTION 'a consultation bill can only be created for a visit awaiting payment'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bills_before_insert BEFORE INSERT ON bills
  FOR EACH ROW EXECUTE FUNCTION bills_before_insert();

CREATE OR REPLACE FUNCTION bills_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.bill_type, NEW.bill_number,
      NEW.bill_date, NEW.subtotal_paise, NEW.tax_paise, NEW.total_paise, NEW.idempotency_key,
      NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.bill_type, OLD.bill_number,
      OLD.bill_date, OLD.subtotal_paise, OLD.tax_paise, OLD.total_paise, OLD.idempotency_key,
      OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'bills are immutable' USING ERRCODE = '23514';
  END IF;
  IF (NEW.paid_paise, NEW.refunded_paise, NEW.payment_status)
     IS DISTINCT FROM (OLD.paid_paise, OLD.refunded_paise, OLD.payment_status)
     AND coalesce(current_setting('hospigo.ledger_update', true), '') <> 'on' THEN
    RAISE EXCEPTION 'paid amounts of a bill are maintained by the ledger only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bills_guard_update BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION bills_guard_update();

-- Every bill with a total writes its CHARGE ledger row (a zero bill moves no money: no row).
CREATE OR REPLACE FUNCTION bills_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  IF NEW.total_paise > 0 THEN
    INSERT INTO ledger_entries (id, tenant_id, bill_id, branch_id, entry_type, amount_paise)
    VALUES (gen_random_uuid()::text, NEW.tenant_id, NEW.id, NEW.branch_id, 'CHARGE', NEW.total_paise);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bills_after_insert AFTER INSERT ON bills
  FOR EACH ROW EXECUTE FUNCTION bills_after_insert();

-- ---------------------------------------------------------------------------------------------
-- Payments: lock the bill, refuse overpay / cancelled visit / missing reference, write the ledger
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION payments_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  b record;
  m record;
  v_visit_status visit_status;
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);

  -- The row lock serialises parallel payments on one bill: the second one sees the first's total.
  SELECT total_paise, paid_paise, branch_id, visit_id INTO b
    FROM bills WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bill not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.branch_id <> b.branch_id THEN
    RAISE EXCEPTION 'payment branch must be the bill branch' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO v_visit_status FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = b.visit_id;
  IF v_visit_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'the visit is cancelled' USING ERRCODE = '23514';
  END IF;

  IF NEW.amount_paise > b.total_paise - b.paid_paise THEN
    RAISE EXCEPTION 'payment exceeds the amount due' USING ERRCODE = '23514';
  END IF;

  SELECT requires_reference, active INTO m
    FROM payment_modes WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_mode_id;
  IF NOT FOUND OR NOT m.active THEN
    RAISE EXCEPTION 'payment mode is not available' USING ERRCODE = '23514';
  END IF;
  IF m.requires_reference AND length(btrim(coalesce(NEW.reference_no, ''))) = 0 THEN
    RAISE EXCEPTION 'a reference number is required for this payment mode' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_before_insert BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_before_insert();

CREATE OR REPLACE FUNCTION payments_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  INSERT INTO ledger_entries (id, tenant_id, bill_id, branch_id, entry_type, amount_paise, payment_id)
  VALUES (gen_random_uuid()::text, NEW.tenant_id, NEW.bill_id, NEW.branch_id, 'PAYMENT', NEW.amount_paise, NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_after_insert AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_after_insert();

-- ---------------------------------------------------------------------------------------------
-- Ledger -> bill: paid / refunded / status are RECALCULATED from the ledger (never incremented)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_entries_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  PERFORM 1 FROM bills WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id FOR UPDATE;
  PERFORM set_config('hospigo.ledger_update', 'on', true);
  UPDATE bills b
     SET paid_paise = s.paid,
         refunded_paise = s.refunded,
         payment_status = CASE
           WHEN b.total_paise = 0 THEN 'PAID'
           WHEN s.paid = 0 THEN 'UNPAID'
           WHEN s.paid >= b.total_paise THEN 'PAID'
           ELSE 'PART_PAID'
         END::payment_status
    FROM (
      SELECT coalesce(sum(amount_paise) FILTER (WHERE entry_type = 'PAYMENT'), 0) AS paid,
             coalesce(sum(amount_paise) FILTER (WHERE entry_type = 'REFUND'), 0) AS refunded
        FROM ledger_entries
       WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.bill_id
    ) s
   WHERE b.tenant_id = NEW.tenant_id AND b.id = NEW.bill_id;
  PERFORM set_config('hospigo.ledger_update', 'off', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_after_insert AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_after_insert();

-- ---------------------------------------------------------------------------------------------
-- A bill equals its lines (checked at COMMIT, from both the bill side and the line side, so a
-- line added to an old bill later is refused too). A REGISTRATION line must have its
-- patient_registration_fees record (once-per-patient guarantee).
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bill_matches_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bill_id text;
  b record;
  l record;
BEGIN
  -- IF, not CASE: plpgsql resolves NEW.<field> when it plans an expression, and each table
  -- only has one of these two fields.
  IF TG_TABLE_NAME = 'bills' THEN
    v_bill_id := NEW.id;
  ELSE
    v_bill_id := NEW.bill_id;
  END IF;
  SELECT subtotal_paise, tax_paise, total_paise INTO b
    FROM bills WHERE tenant_id = NEW.tenant_id AND id = v_bill_id;
  SELECT count(*) AS n,
         coalesce(sum(line_total_paise::bigint), 0) AS total,
         coalesce(sum(tax_paise::bigint), 0) AS tax
    INTO l FROM bill_lines WHERE tenant_id = NEW.tenant_id AND bill_id = v_bill_id;
  IF l.n = 0 OR l.total <> b.total_paise OR l.tax <> b.tax_paise
     OR (l.total - l.tax) <> b.subtotal_paise THEN
    RAISE EXCEPTION 'bill amounts must equal the sum of its lines' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER bills_match_lines AFTER INSERT ON bills
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bill_matches_lines();
CREATE CONSTRAINT TRIGGER bill_lines_match_bill AFTER INSERT ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bill_matches_lines();

CREATE OR REPLACE FUNCTION bill_line_registration_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind = 'REGISTRATION' AND NOT EXISTS (
    SELECT 1 FROM patient_registration_fees f
     WHERE f.tenant_id = NEW.tenant_id AND f.bill_line_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a registration line needs its patient_registration_fees record'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER bill_lines_registration_record AFTER INSERT ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bill_line_registration_record();

CREATE OR REPLACE FUNCTION patient_registration_fees_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (l.kind = 'REGISTRATION' AND v.patient_id = NEW.patient_id) INTO v_ok
    FROM bill_lines l
    JOIN bills b ON b.tenant_id = l.tenant_id AND b.id = l.bill_id
    JOIN opd_visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
   WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.bill_line_id;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'the line must be a REGISTRATION line on a bill of the same patient'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a registration fee record cannot be created already voided' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patient_registration_fees_before_insert BEFORE INSERT ON patient_registration_fees
  FOR EACH ROW EXECUTE FUNCTION patient_registration_fees_before_insert();

-- ---------------------------------------------------------------------------------------------
-- Counters only move forward (follow-up from Step 3a): numbers can never repeat.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refuse_number_series_decrease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.last_number < OLD.last_number THEN
    RAISE EXCEPTION 'number_series.last_number can only move forward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER number_series_forward_only BEFORE UPDATE ON number_series
  FOR EACH ROW EXECUTE FUNCTION refuse_number_series_decrease();

CREATE OR REPLACE FUNCTION refuse_token_counter_decrease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.last_token < OLD.last_token THEN
    RAISE EXCEPTION 'token_counters.last_token can only move forward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER token_counters_forward_only BEFORE UPDATE ON token_counters
  FOR EACH ROW EXECUTE FUNCTION refuse_token_counter_decrease();
