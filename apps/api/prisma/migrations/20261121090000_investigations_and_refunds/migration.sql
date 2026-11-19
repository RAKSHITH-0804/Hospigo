-- Phase 2 Step 6a: tests ordered by the doctor, the investigations bill, refund requests,
-- refunds (follow the original payment mode) and cancelling a waiting visit.
--
-- What the database guarantees (so no API bug can break it):
--   INVESTIGATION ORDERS
--   * only the visit's own doctor orders, only while the visit is IN_CONSULTATION, only a real
--     active test of the hospital's list (name and code are copied at order time);
--   * one order per test per visit; an order moves ORDERED -> BILLED (it points to its bill line)
--     or ORDERED -> NOT_TAKEN (with a reason) and never changes again; only an ORDERED row of a
--     visit still in consultation can be deleted (the doctor changing their mind);
--   * an investigations bill needs a visit that is in consultation or completed, every line of it
--     must be a test that was ordered (checked at commit).
--   REFUNDS
--   * a refund request holds who asked, why, how much; the Admin who decides is never the person
--     who asked; a decided request never changes again;
--   * an approved request writes refunds, one per original payment, in the ORIGINAL payment mode,
--     never more than that payment received, never more than the bill's paid minus refunded; a
--     refund writes its REFUND ledger row itself; bills are never edited;
--   * NO refund of a consultation bill once the consultation has started;
--   * the bill is locked first, so two approvals at the same moment cannot return the money twice;
--   * at commit, an approved request equals the sum of its refunds (and an approved cancellation
--     leaves the visit CANCELLED);
--   * a WAITING visit can only be cancelled through an approved cancellation request.
--   Every new table has forced row level security by hospital; hospigo_hq / hospigo_patient have
--   NO grants. Who may ask and who may approve is the API's job (permissions); nothing here
--   relaxes any earlier protection.

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------

CREATE TYPE "investigation_order_status" AS ENUM ('ORDERED', 'BILLED', 'NOT_TAKEN');
CREATE TYPE "refund_request_type" AS ENUM ('REFUND', 'CANCEL_VISIT');
CREATE TYPE "refund_request_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

-- A refund must point to the payment it returns money from, on the SAME bill.
CREATE UNIQUE INDEX "payments_tenant_id_id_bill_id_key" ON "payments"("tenant_id", "id", "bill_id");

-- ---------------------------------------------------------------------------------------------
-- investigation_orders
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "investigation_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "charge_item_id" TEXT NOT NULL,
    "code_snapshot" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "status" "investigation_order_status" NOT NULL DEFAULT 'ORDERED',
    "bill_line_id" TEXT,
    "not_taken_reason" TEXT,
    "ordered_by" TEXT NOT NULL,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "investigation_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "investigation_orders_snapshot_chk" CHECK (
      length(btrim("code_snapshot")) > 0 AND length(btrim("name_snapshot")) > 0
    ),
    CONSTRAINT "investigation_orders_status_chk" CHECK (
      ("status" = 'ORDERED' AND "bill_line_id" IS NULL AND "not_taken_reason" IS NULL
        AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
      OR ("status" = 'BILLED' AND "bill_line_id" IS NOT NULL AND "not_taken_reason" IS NULL
        AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
      OR ("status" = 'NOT_TAKEN' AND "bill_line_id" IS NULL
        AND length(btrim(coalesce("not_taken_reason", ''))) > 0
        AND length("not_taken_reason") <= 500
        AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "investigation_orders_tenant_id_id_key" ON "investigation_orders"("tenant_id", "id");
CREATE UNIQUE INDEX "investigation_orders_visit_test_key"
  ON "investigation_orders"("tenant_id", "visit_id", "charge_item_id");
CREATE UNIQUE INDEX "investigation_orders_bill_line_key"
  ON "investigation_orders"("tenant_id", "bill_line_id");
CREATE INDEX "investigation_orders_pending_idx"
  ON "investigation_orders"("tenant_id", "branch_id", "status", "created_at");

ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_visit_fkey"
  FOREIGN KEY ("tenant_id", "visit_id", "branch_id") REFERENCES "opd_visits"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_doctor_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_charge_item_fkey"
  FOREIGN KEY ("tenant_id", "charge_item_id") REFERENCES "charge_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_bill_line_fkey"
  FOREIGN KEY ("tenant_id", "bill_line_id") REFERENCES "bill_lines"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_ordered_by_fkey"
  FOREIGN KEY ("tenant_id", "ordered_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_resolved_by_fkey"
  FOREIGN KEY ("tenant_id", "resolved_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- refund_requests
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "refund_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "request_type" "refund_request_type" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "refund_request_status" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "refund_number" TEXT,
    "idempotency_key" TEXT NOT NULL,
    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id"),
    -- A refund returns money; a cancellation of a free visit may return none.
    CONSTRAINT "refund_requests_amount_chk" CHECK (
      ("request_type" = 'REFUND' AND "amount_paise" > 0)
      OR ("request_type" = 'CANCEL_VISIT' AND "amount_paise" >= 0)
    ),
    CONSTRAINT "refund_requests_reason_chk" CHECK (
      length(btrim("reason")) > 0 AND length("reason") <= 500
    ),
    CONSTRAINT "refund_requests_key_chk" CHECK (length(btrim("idempotency_key")) > 0),
    CONSTRAINT "refund_requests_note_chk" CHECK (length(coalesce("decision_note", '')) <= 500),
    CONSTRAINT "refund_requests_decision_chk" CHECK (
      ("status" = 'REQUESTED' AND "decided_by" IS NULL AND "decided_at" IS NULL
        AND "decision_note" IS NULL AND "refund_number" IS NULL)
      -- Approved: the voucher number exists exactly when money is returned.
      OR ("status" = 'APPROVED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
        AND ("amount_paise" > 0) = ("refund_number" IS NOT NULL))
      OR ("status" = 'REJECTED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
        AND length(btrim(coalesce("decision_note", ''))) > 0 AND "refund_number" IS NULL)
    ),
    CONSTRAINT "refund_requests_decider_chk" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);

CREATE UNIQUE INDEX "refund_requests_tenant_id_id_key" ON "refund_requests"("tenant_id", "id");
CREATE UNIQUE INDEX "refund_requests_tenant_id_id_bill_id_key" ON "refund_requests"("tenant_id", "id", "bill_id");
CREATE UNIQUE INDEX "refund_requests_idempotency_key" ON "refund_requests"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "refund_requests_refund_number_key" ON "refund_requests"("tenant_id", "refund_number");
CREATE INDEX "refund_requests_list_idx" ON "refund_requests"("tenant_id", "branch_id", "status", "requested_at");
CREATE INDEX "refund_requests_bill_idx" ON "refund_requests"("tenant_id", "bill_id");

ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_bill_fkey"
  FOREIGN KEY ("tenant_id", "bill_id", "branch_id") REFERENCES "bills"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_visit_fkey"
  FOREIGN KEY ("tenant_id", "visit_id", "branch_id") REFERENCES "opd_visits"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_fkey"
  FOREIGN KEY ("tenant_id", "requested_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_fkey"
  FOREIGN KEY ("tenant_id", "decided_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- refunds (append-only; one row per original payment returned)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "payment_mode_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reference_no" TEXT,
    "refunded_by" TEXT NOT NULL,
    "refunded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_chk" CHECK ("amount_paise" > 0)
);

CREATE UNIQUE INDEX "refunds_tenant_id_id_key" ON "refunds"("tenant_id", "id");
CREATE UNIQUE INDEX "refunds_request_payment_key" ON "refunds"("tenant_id", "request_id", "payment_id");
CREATE INDEX "refunds_bill_idx" ON "refunds"("tenant_id", "bill_id");
CREATE INDEX "refunds_payment_idx" ON "refunds"("tenant_id", "payment_id");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bill_fkey"
  FOREIGN KEY ("tenant_id", "bill_id", "branch_id") REFERENCES "bills"("tenant_id", "id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- The request and the payment must both belong to THIS bill.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_request_fkey"
  FOREIGN KEY ("tenant_id", "request_id", "bill_id") REFERENCES "refund_requests"("tenant_id", "id", "bill_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_fkey"
  FOREIGN KEY ("tenant_id", "payment_id", "bill_id") REFERENCES "payments"("tenant_id", "id", "bill_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_mode_fkey"
  FOREIGN KEY ("tenant_id", "payment_mode_id") REFERENCES "payment_modes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_refunded_by_fkey"
  FOREIGN KEY ("tenant_id", "refunded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row level security (hospital), grants
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "investigation_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "investigation_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refund_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;

CREATE POLICY investigation_orders_app_all ON investigation_orders
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY refund_requests_app_all ON refund_requests
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY refunds_app_all ON refunds
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- hospigo_hq / hospigo_patient: intentionally NO grants. The app role may only move an order to
-- its next state, decide a request (the decision columns), and add refunds.
GRANT SELECT, INSERT, DELETE ON TABLE investigation_orders TO hospigo_app;
GRANT UPDATE ("status", "bill_line_id", "not_taken_reason", "resolved_by", "resolved_at")
  ON TABLE investigation_orders TO hospigo_app;
GRANT SELECT, INSERT ON TABLE refund_requests TO hospigo_app;
GRANT UPDATE ("status", "decided_by", "decided_at", "decision_note", "refund_number")
  ON TABLE refund_requests TO hospigo_app;
GRANT SELECT, INSERT ON TABLE refunds TO hospigo_app;
GRANT ALL ON TABLE investigation_orders, refund_requests, refunds TO hospigo_owner;

-- ---------------------------------------------------------------------------------------------
-- Delete / truncate protection (reuses the Step 2 functions)
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER investigation_orders_refuse_truncate BEFORE TRUNCATE ON investigation_orders
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER refund_requests_refuse_delete BEFORE DELETE ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER refund_requests_refuse_truncate BEFORE TRUNCATE ON refund_requests
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER refunds_refuse_update BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER refunds_refuse_delete BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER refunds_refuse_truncate BEFORE TRUNCATE ON refunds
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- ---------------------------------------------------------------------------------------------
-- investigation_orders: who may order, how an order moves on, when it may be removed
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION investigation_orders_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v record;
  d record;
  c record;
BEGIN
  -- FOR SHARE: the visit cannot move on (to COMPLETED) while the order is being written.
  SELECT status::text AS status, doctor_profile_id INTO v
    FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id FOR SHARE;
  IF NOT FOUND OR v.status <> 'IN_CONSULTATION' THEN
    RAISE EXCEPTION 'tests can only be ordered while the visit is in consultation' USING ERRCODE = '23514';
  END IF;
  IF v.doctor_profile_id <> NEW.doctor_profile_id THEN
    RAISE EXCEPTION 'tests are ordered by the doctor of the visit' USING ERRCODE = '23514';
  END IF;
  SELECT user_id INTO d FROM doctor_profiles WHERE tenant_id = NEW.tenant_id AND id = NEW.doctor_profile_id;
  IF NOT FOUND OR d.user_id <> NEW.ordered_by THEN
    RAISE EXCEPTION 'tests are ordered by the doctor of the visit' USING ERRCODE = '23514';
  END IF;
  SELECT code, name, kind::text AS kind, active INTO c
    FROM charge_items WHERE tenant_id = NEW.tenant_id AND id = NEW.charge_item_id;
  IF NOT FOUND OR c.kind <> 'INVESTIGATION' OR NOT c.active THEN
    RAISE EXCEPTION 'only an active test of the hospital list can be ordered' USING ERRCODE = '23514';
  END IF;
  IF (c.code, c.name) IS DISTINCT FROM (NEW.code_snapshot, NEW.name_snapshot) THEN
    RAISE EXCEPTION 'the test name must be a true copy of the tests list' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'ORDERED' THEN
    RAISE EXCEPTION 'an order always starts as ORDERED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER investigation_orders_before_insert BEFORE INSERT ON investigation_orders
  FOR EACH ROW EXECUTE FUNCTION investigation_orders_before_insert();

CREATE OR REPLACE FUNCTION investigation_orders_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  ln record;
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.visit_id, NEW.doctor_profile_id, NEW.charge_item_id,
      NEW.code_snapshot, NEW.name_snapshot, NEW.ordered_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.visit_id, OLD.doctor_profile_id, OLD.charge_item_id,
      OLD.code_snapshot, OLD.name_snapshot, OLD.ordered_by, OLD.created_at) THEN
    RAISE EXCEPTION 'investigation order identity columns are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'ORDERED' THEN
    RAISE EXCEPTION 'a billed or not-taken order cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('BILLED', 'NOT_TAKEN') THEN
    RAISE EXCEPTION 'an order can only move to BILLED or NOT_TAKEN' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'BILLED' THEN
    SELECT l.charge_item_id, b.visit_id, b.bill_type::text AS bill_type INTO ln
      FROM bill_lines l
      JOIN bills b ON b.tenant_id = l.tenant_id AND b.id = l.bill_id
     WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.bill_line_id;
    IF NOT FOUND OR ln.bill_type <> 'INVESTIGATION' OR ln.visit_id <> NEW.visit_id
       OR ln.charge_item_id IS DISTINCT FROM NEW.charge_item_id THEN
      RAISE EXCEPTION 'a billed order must point to its own line on an investigations bill of the visit'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER investigation_orders_guard_update BEFORE UPDATE ON investigation_orders
  FOR EACH ROW EXECUTE FUNCTION investigation_orders_guard_update();

CREATE OR REPLACE FUNCTION investigation_orders_guard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF OLD.status <> 'ORDERED' THEN
    RAISE EXCEPTION 'a billed or not-taken order cannot be removed' USING ERRCODE = '23514';
  END IF;
  SELECT status::text INTO v_status
    FROM opd_visits WHERE tenant_id = OLD.tenant_id AND id = OLD.visit_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'IN_CONSULTATION' THEN
    RAISE EXCEPTION 'orders can only be removed while the visit is in consultation' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER investigation_orders_guard_delete BEFORE DELETE ON investigation_orders
  FOR EACH ROW EXECUTE FUNCTION investigation_orders_guard_delete();

-- ---------------------------------------------------------------------------------------------
-- Investigations bill: allowed visit states (the Step 4a trigger plus ONE new rule)
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

  -- NEW (6a): tests are billed after the doctor ordered them, while the visit is in consultation
  -- or already completed (never for a waiting, unpaid or cancelled visit).
  IF NEW.bill_type = 'INVESTIGATION' THEN
    SELECT status INTO v_status FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id;
    IF v_status IS NULL OR v_status NOT IN ('IN_CONSULTATION', 'COMPLETED') THEN
      RAISE EXCEPTION 'an investigations bill needs a visit that is in consultation or completed'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Every line of an investigations bill is a test that was ordered (checked at COMMIT, after the
-- orders were linked to their lines), and tests never sit on a consultation bill.
CREATE OR REPLACE FUNCTION bill_line_investigation_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_type text;
BEGIN
  SELECT bill_type::text INTO v_type FROM bills WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id;
  IF v_type = 'INVESTIGATION' THEN
    IF NEW.kind <> 'INVESTIGATION' OR NEW.charge_item_id IS NULL THEN
      RAISE EXCEPTION 'an investigations bill holds test lines only' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM investigation_orders o
       WHERE o.tenant_id = NEW.tenant_id AND o.bill_line_id = NEW.id AND o.status = 'BILLED'
    ) THEN
      RAISE EXCEPTION 'a test line must belong to a test the doctor ordered' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind = 'INVESTIGATION' THEN
    RAISE EXCEPTION 'a test line belongs on an investigations bill' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- (named so that it fires AFTER bill_lines_match_bill: deferred triggers run in name order)
CREATE CONSTRAINT TRIGGER bill_lines_test_order AFTER INSERT ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bill_line_investigation_order();

-- ---------------------------------------------------------------------------------------------
-- Refund rules shared by "ask" and "approve"
-- ---------------------------------------------------------------------------------------------
-- The bill is locked FIRST (FOR UPDATE) so two requests on one bill run one after the other.

CREATE OR REPLACE FUNCTION refund_request_assert(
  p_tenant text,
  p_bill_id text,
  p_visit_id text,
  p_type refund_request_type,
  p_amount integer,
  p_self_id text,
  p_check_pending boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  b record;
  v record;
  v_pending bigint;
BEGIN
  PERFORM opd_assert_tenant(p_tenant);
  SELECT visit_id, bill_type::text AS bill_type, paid_paise, refunded_paise INTO b
    FROM bills WHERE tenant_id = p_tenant AND id = p_bill_id FOR UPDATE;
  IF NOT FOUND OR b.visit_id <> p_visit_id THEN
    RAISE EXCEPTION 'the bill is not a bill of this visit' USING ERRCODE = '23514';
  END IF;
  SELECT status::text AS status, consultation_started_at INTO v
    FROM opd_visits WHERE tenant_id = p_tenant AND id = p_visit_id FOR UPDATE;

  -- No refund of the consultation once it has started (confirmed rule).
  IF b.bill_type = 'CONSULTATION' AND v.consultation_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'the consultation has started: the consultation bill cannot be refunded'
      USING ERRCODE = '23514';
  END IF;

  IF p_type = 'CANCEL_VISIT' THEN
    IF b.bill_type <> 'CONSULTATION' THEN
      RAISE EXCEPTION 'a visit is cancelled through its consultation bill' USING ERRCODE = '23514';
    END IF;
    IF v.status <> 'WAITING' THEN
      RAISE EXCEPTION 'only a waiting visit can be cancelled' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_amount > b.paid_paise - b.refunded_paise THEN
    RAISE EXCEPTION 'the amount is more than what was paid and not yet refunded' USING ERRCODE = '23514';
  END IF;
  IF p_check_pending THEN
    SELECT coalesce(sum(amount_paise::bigint), 0) INTO v_pending
      FROM refund_requests
     WHERE tenant_id = p_tenant AND bill_id = p_bill_id AND status = 'REQUESTED'
       AND id IS DISTINCT FROM p_self_id;
    IF p_amount > b.paid_paise - b.refunded_paise - v_pending THEN
      RAISE EXCEPTION 'other open requests already cover the refundable amount' USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION refund_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  IF NEW.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'a request always starts as REQUESTED' USING ERRCODE = '23514';
  END IF;
  PERFORM refund_request_assert(
    NEW.tenant_id, NEW.bill_id, NEW.visit_id, NEW.request_type, NEW.amount_paise, NEW.id, true
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER refund_requests_before_insert BEFORE INSERT ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION refund_requests_before_insert();

CREATE OR REPLACE FUNCTION refund_requests_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.bill_id, NEW.visit_id, NEW.request_type,
      NEW.amount_paise, NEW.reason, NEW.requested_by, NEW.requested_at, NEW.idempotency_key)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.bill_id, OLD.visit_id, OLD.request_type,
      OLD.amount_paise, OLD.reason, OLD.requested_by, OLD.requested_at, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'a refund request cannot be edited' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'a decided request cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'a request can only be approved or rejected' USING ERRCODE = '23514';
  END IF;
  IF NEW.decided_by IS NOT DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'the person who asked cannot decide the request' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'APPROVED' THEN
    -- The rules are checked again at the moment of approval (the visit may have moved on).
    PERFORM refund_request_assert(
      NEW.tenant_id, NEW.bill_id, NEW.visit_id, NEW.request_type, NEW.amount_paise, NEW.id, false
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refund_requests_guard_update BEFORE UPDATE ON refund_requests
  FOR EACH ROW EXECUTE FUNCTION refund_requests_guard_update();

-- ---------------------------------------------------------------------------------------------
-- refunds: original mode, never more than that payment, ledger row written here
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refunds_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  b record;
  q record;
  p record;
  m record;
  v_started timestamptz;
  v_done bigint;
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  -- Same lock order as the request rules: the bill first.
  SELECT branch_id, visit_id, bill_type::text AS bill_type, paid_paise, refunded_paise INTO b
    FROM bills WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bill not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.branch_id <> b.branch_id THEN
    RAISE EXCEPTION 'refund branch must be the bill branch' USING ERRCODE = '23514';
  END IF;

  SELECT status::text AS status, decided_by INTO q
    FROM refund_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.request_id;
  IF NOT FOUND OR q.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'money is returned only for an approved request' USING ERRCODE = '23514';
  END IF;
  IF NEW.refunded_by IS DISTINCT FROM q.decided_by THEN
    RAISE EXCEPTION 'the refund is recorded by the person who approved it' USING ERRCODE = '23514';
  END IF;

  SELECT amount_paise, payment_mode_id INTO p
    FROM payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
  IF NOT FOUND OR p.payment_mode_id <> NEW.payment_mode_id THEN
    RAISE EXCEPTION 'a refund follows the original payment mode' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(amount_paise::bigint), 0) INTO v_done
    FROM refunds WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id;
  IF NEW.amount_paise > p.amount_paise - v_done THEN
    RAISE EXCEPTION 'a refund is more than that payment can still return' USING ERRCODE = '23514';
  END IF;
  IF NEW.amount_paise > b.paid_paise - b.refunded_paise THEN
    RAISE EXCEPTION 'a refund is more than the bill has left to return' USING ERRCODE = '23514';
  END IF;

  IF b.bill_type = 'CONSULTATION' THEN
    SELECT consultation_started_at INTO v_started
      FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = b.visit_id;
    IF v_started IS NOT NULL THEN
      RAISE EXCEPTION 'the consultation has started: the consultation bill cannot be refunded'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT requires_reference INTO m
    FROM payment_modes WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_mode_id;
  IF m.requires_reference AND length(btrim(coalesce(NEW.reference_no, ''))) = 0 THEN
    RAISE EXCEPTION 'a reference number is required for this payment mode' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_before_insert BEFORE INSERT ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_before_insert();

CREATE OR REPLACE FUNCTION refunds_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  -- The ledger trigger then recalculates refunded_paise of the bill (the bill itself is not edited).
  INSERT INTO ledger_entries (id, tenant_id, bill_id, branch_id, entry_type, amount_paise)
  VALUES (gen_random_uuid()::text, NEW.tenant_id, NEW.bill_id, NEW.branch_id, 'REFUND', NEW.amount_paise);
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_after_insert AFTER INSERT ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_after_insert();

-- ---------------------------------------------------------------------------------------------
-- At commit: an approved request equals its refunds; an approved cancellation cancels the visit
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refund_request_matches_refunds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request_id text;
  q record;
  r record;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'refund_requests' THEN
    v_request_id := NEW.id;
  ELSE
    v_request_id := NEW.request_id;
  END IF;
  SELECT status::text AS status, amount_paise, request_type::text AS request_type, visit_id INTO q
    FROM refund_requests WHERE tenant_id = NEW.tenant_id AND id = v_request_id;
  SELECT count(*) AS n, coalesce(sum(amount_paise::bigint), 0) AS total INTO r
    FROM refunds WHERE tenant_id = NEW.tenant_id AND request_id = v_request_id;
  IF q.status = 'APPROVED' THEN
    IF r.total <> q.amount_paise THEN
      RAISE EXCEPTION 'an approved request must equal the sum of its refunds' USING ERRCODE = '23514';
    END IF;
    IF q.request_type = 'CANCEL_VISIT' THEN
      SELECT status::text INTO v_status FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = q.visit_id;
      IF v_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'an approved cancellation must leave the visit cancelled' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF r.n > 0 THEN
    RAISE EXCEPTION 'only an approved request can have refunds' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER refund_requests_match_refunds AFTER UPDATE ON refund_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION refund_request_matches_refunds();
CREATE CONSTRAINT TRIGGER refunds_match_request AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION refund_request_matches_refunds();

-- ---------------------------------------------------------------------------------------------
-- Visit guard: the 5a guard plus ONE new rule. A WAITING visit becomes CANCELLED only through an
-- approved cancellation request. (Everything else below is copied unchanged.)
-- ---------------------------------------------------------------------------------------------

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

  -- Completing a visit needs a completed consultation note (Step 5a-2).
  IF OLD.status = 'IN_CONSULTATION' AND NEW.status = 'COMPLETED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM consultations c
      WHERE c.tenant_id = NEW.tenant_id AND c.visit_id = NEW.id AND c.status = 'COMPLETED'
    ) THEN
      RAISE EXCEPTION 'a visit cannot be completed before its consultation note is completed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- NEW (6a): a paid, waiting visit is cancelled only through an approved cancellation request.
  IF OLD.status = 'WAITING' AND NEW.status = 'CANCELLED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM refund_requests q
      WHERE q.tenant_id = NEW.tenant_id AND q.visit_id = NEW.id
        AND q.request_type = 'CANCEL_VISIT' AND q.status = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'a waiting visit can only be cancelled through an approved cancellation request'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
