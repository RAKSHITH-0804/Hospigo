-- Step 7f follow-up: a refund can still be made on the bill of an ALREADY-CANCELLED visit (the
-- consultation never started, and a partial refund at cancel time leaves money to return). The
-- cancel-time trigger (20261126090000) only looks at the moment the visit becomes CANCELLED, so a
-- fee that was kept after a partial refund must also be voided when LATER refunds bring the bill
-- to a full refund. Same rule as before: the whole bill refunded (refunded_paise >= total_paise)
-- and the visit is CANCELLED. A refund on a visit that is not cancelled never voids the fee.
--
-- Deferred (checked at COMMIT) so the ledger has already recalculated bills.refunded_paise.
-- SECURITY DEFINER with the tenant check, no new right for the application login. Idempotent:
-- only a fee that is still active is voided, so it fires harmlessly once per refund row.

CREATE OR REPLACE FUNCTION refund_completes_voids_registration_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM opd_assert_tenant(NEW.tenant_id);
  UPDATE patient_registration_fees f
     SET voided_at = NEW.refunded_at
   WHERE f.tenant_id = NEW.tenant_id
     AND f.voided_at IS NULL
     AND f.bill_line_id IN (
           SELECT l.id
             FROM bill_lines l
             JOIN bills b ON b.tenant_id = l.tenant_id AND b.id = l.bill_id
             JOIN opd_visits v ON v.tenant_id = b.tenant_id AND v.id = b.visit_id
            WHERE l.tenant_id = NEW.tenant_id
              AND b.id = NEW.bill_id
              AND l.kind = 'REGISTRATION'
              AND v.status = 'CANCELLED'
              AND b.refunded_paise >= b.total_paise);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION refund_completes_voids_registration_fee() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER refunds_complete_voids_registration_fee
  AFTER INSERT ON refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION refund_completes_voids_registration_fee();
