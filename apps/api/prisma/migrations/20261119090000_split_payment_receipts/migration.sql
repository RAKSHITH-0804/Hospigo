-- Phase 2 Step 5a-1: split payment, ONE receipt for several payments.
--
-- Example: a bill of 500 paid as UPI 300 + cash 200 is one receipt (one receipt number) with two
-- payments. Until now the receipt number lived on each payment and was unique per payment, so two
-- payments could not share one. The receipt number and total now live on a new append-only
-- `receipts` table and every payment points to its receipt.
--
-- What the database guarantees (so no API bug can break it):
--   * receipts are append-only (UPDATE / DELETE / TRUNCATE refused, owner too) with forced row
--     level security by hospital; hospigo_hq / hospigo_patient have NO grants;
--   * a receipt belongs to exactly one bill of the same hospital and branch, and every payment
--     of a receipt is on that same bill (composite foreign keys); the hospital of the session
--     must match (same helper as payments) and the bill is locked first (no deadlock between
--     parallel payers);
--   * at commit, a receipt's total equals the sum of its payments and it has at least one payment
--     (deferred constraint trigger, like "bill equals its lines");
--   * one payment mode appears at most once per receipt;
--   * the receipt number is unique per hospital.
-- The overpay lock, the ledger triggers and the branch rules of payments are unchanged.
-- Existing payments (dev data) each get one receipt that carries their old receipt number.

-- ---------------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "issued_by" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipts_total_chk" CHECK ("total_paise" > 0),
    CONSTRAINT "receipts_key_chk" CHECK (
      length(btrim("receipt_number")) > 0 AND length(btrim("idempotency_key")) > 0
    )
);

-- Existing payments: one receipt each, carrying the old receipt number (nothing is lost).
INSERT INTO "receipts"
  ("id", "tenant_id", "branch_id", "bill_id", "receipt_number", "total_paise", "issued_by",
   "idempotency_key", "created_at")
SELECT gen_random_uuid()::text, p."tenant_id", p."branch_id", p."bill_id", p."receipt_number",
       p."amount_paise", p."received_by", p."idempotency_key", p."created_at"
  FROM "payments" p;

CREATE UNIQUE INDEX "receipts_tenant_id_id_key" ON "receipts"("tenant_id", "id");
CREATE UNIQUE INDEX "receipts_tenant_id_id_bill_id_key" ON "receipts"("tenant_id", "id", "bill_id");
CREATE UNIQUE INDEX "receipts_tenant_id_receipt_number_key" ON "receipts"("tenant_id", "receipt_number");
CREATE UNIQUE INDEX "receipts_tenant_id_idempotency_key_key" ON "receipts"("tenant_id", "idempotency_key");
CREATE INDEX "receipts_bill_idx" ON "receipts"("tenant_id", "bill_id");

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_bill_fkey"
  FOREIGN KEY ("tenant_id", "bill_id", "branch_id") REFERENCES "bills"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issued_by_fkey"
  FOREIGN KEY ("tenant_id", "issued_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- payments: point to the receipt, drop the per-payment receipt number
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "payments" ADD COLUMN "receipt_id" TEXT;

-- payments are append-only; this one-time link of existing rows is the only change ever made,
-- done by the owner inside this migration with the guard switched off and back on.
ALTER TABLE "payments" DISABLE TRIGGER payments_refuse_update;
UPDATE "payments" p
   SET "receipt_id" = r."id"
  FROM "receipts" r
 WHERE r."tenant_id" = p."tenant_id" AND r."receipt_number" = p."receipt_number";
ALTER TABLE "payments" ENABLE TRIGGER payments_refuse_update;

ALTER TABLE "payments" ALTER COLUMN "receipt_id" SET NOT NULL;

ALTER TABLE "payments" DROP CONSTRAINT "payments_key_chk";
DROP INDEX "payments_tenant_id_receipt_number_key";
ALTER TABLE "payments" DROP COLUMN "receipt_number";
ALTER TABLE "payments" ADD CONSTRAINT "payments_key_chk" CHECK (length(btrim("idempotency_key")) > 0);

-- The payment's bill must be the receipt's bill (and so its branch and hospital too).
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_fkey"
  FOREIGN KEY ("tenant_id", "receipt_id", "bill_id") REFERENCES "receipts"("tenant_id", "id", "bill_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One payment mode at most once per receipt (UPI 300 + UPI 200 is just UPI 500).
CREATE UNIQUE INDEX "payments_receipt_mode_key" ON "payments"("tenant_id", "receipt_id", "payment_mode_id");
CREATE INDEX "payments_receipt_idx" ON "payments"("tenant_id", "receipt_id");

-- ---------------------------------------------------------------------------------------------
-- Row level security, grants, append-only
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY receipts_app_all ON receipts
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT ON TABLE receipts TO hospigo_app;
GRANT ALL ON TABLE receipts TO hospigo_owner;

CREATE TRIGGER receipts_refuse_update BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER receipts_refuse_delete BEFORE DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER receipts_refuse_truncate BEFORE TRUNCATE ON receipts
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- ---------------------------------------------------------------------------------------------
-- Before a receipt is inserted: hospital check and the bill lock
-- ---------------------------------------------------------------------------------------------
-- The row lock on the bill is taken HERE, before the foreign-key check of the receipt. Without it
-- the foreign key takes a weak lock on the bill first and the payment trigger then asks for the
-- strong one: two requests paying the same bill would deadlock. Taking the strong lock first
-- makes parallel payers queue up one behind the other (the payment trigger then sees the totals).

CREATE OR REPLACE FUNCTION receipts_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  PERFORM 1 FROM bills WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bill not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER receipts_before_insert BEFORE INSERT ON receipts
  FOR EACH ROW EXECUTE FUNCTION receipts_before_insert();

-- ---------------------------------------------------------------------------------------------
-- At commit: a receipt equals the sum of its payments (and has at least one)
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION receipt_matches_payments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt_id text;
  r record;
  p record;
BEGIN
  -- IF, not CASE: each table only has one of these two fields (see bill_matches_lines).
  IF TG_TABLE_NAME = 'receipts' THEN
    v_receipt_id := NEW.id;
  ELSE
    v_receipt_id := NEW.receipt_id;
  END IF;
  SELECT total_paise INTO r
    FROM receipts WHERE tenant_id = NEW.tenant_id AND id = v_receipt_id;
  SELECT count(*) AS n, coalesce(sum(amount_paise::bigint), 0) AS total
    INTO p FROM payments WHERE tenant_id = NEW.tenant_id AND receipt_id = v_receipt_id;
  IF p.n = 0 OR p.total <> r.total_paise THEN
    RAISE EXCEPTION 'a receipt must equal the sum of its payments' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER receipts_match_payments AFTER INSERT ON receipts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION receipt_matches_payments();
CREATE CONSTRAINT TRIGGER payments_match_receipt AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION receipt_matches_payments();
