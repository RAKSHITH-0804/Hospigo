-- Step 7f: the registration fee is charged AGAIN after a cancelled first visit, but only when that
-- fee was really given back.
--
-- Why a trigger: patient_registration_fees.voided_at existed since Step 4a, but the application
-- login has no UPDATE right on the table, so nothing could ever void a fee. The application still
-- gets NO new right: a SECURITY DEFINER trigger does the voiding, the same pattern as the ledger.
--
-- Rule (money): when a visit becomes CANCELLED, the registration fee charged on THAT visit's bill is
-- voided only if the whole bill has been refunded (refunded_paise >= total_paise). The cancel flow
-- does NOT always refund everything (the amount of a cancellation may be zero or partial), and a
-- refund is per bill, not per line, so "the registration line was refunded in full" can only be
-- proven by "the bill was refunded in full". A partial refund keeps the fee, so the patient is
-- never charged twice for something that was not given back.
--
-- The check runs at COMMIT (deferred), when every refund of the request exists and the ledger has
-- recalculated the bill, so it does not depend on the order of the statements.

-- 1. Every column of patient_registration_fees except voided_at is frozen; voided_at moves only
--    from NULL to a time, never back. Applies to every login, the owner included.
CREATE OR REPLACE FUNCTION patient_registration_fees_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.bill_line_id, NEW.charged_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.bill_line_id, OLD.charged_at) THEN
    RAISE EXCEPTION 'a registration fee record can only be voided, not changed' USING ERRCODE = '23514';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a voided registration fee cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.voided_at IS NULL THEN
    RAISE EXCEPTION 'nothing changed: only voiding is allowed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER patient_registration_fees_guard_update
  BEFORE UPDATE ON patient_registration_fees
  FOR EACH ROW EXECUTE FUNCTION patient_registration_fees_guard_update();

-- 2. A cancelled visit voids the fee charged on its own bill when that bill was refunded in full.
CREATE OR REPLACE FUNCTION opd_visit_cancel_voids_registration_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  IF NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'a cancelled visit needs its cancellation time' USING ERRCODE = '23514';
  END IF;
  UPDATE patient_registration_fees f
     SET voided_at = NEW.cancelled_at
   WHERE f.tenant_id = NEW.tenant_id
     AND f.patient_id = NEW.patient_id
     AND f.voided_at IS NULL
     AND f.bill_line_id IN (
           SELECT l.id
             FROM bill_lines l
             JOIN bills b ON b.tenant_id = l.tenant_id AND b.id = l.bill_id
            WHERE l.tenant_id = NEW.tenant_id
              AND b.visit_id = NEW.id
              AND l.kind = 'REGISTRATION'
              AND b.refunded_paise >= b.total_paise);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION opd_visit_cancel_voids_registration_fee() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER opd_visits_cancel_voids_registration_fee
  AFTER UPDATE OF status ON opd_visits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'CANCELLED' AND NEW.status = 'CANCELLED')
  EXECUTE FUNCTION opd_visit_cancel_voids_registration_fee();
