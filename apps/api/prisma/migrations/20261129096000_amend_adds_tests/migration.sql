-- Step 2.1g: an Admin who amends a COMPLETED note may ADD tests (they then wait to be billed).
-- The rule "tests are ordered by the doctor, during the consultation" stays exactly as it was; ONE
-- narrow exception is added: the visit is COMPLETED and the transaction says it is an amend that adds
-- tests (app.amend_tests = 'on', set only by that code path, which needs the amend permission). The
-- order still belongs to the visit's doctor, must be an active test of the hospital list with a true
-- name copy, and starts as ORDERED. Updates and deletes of orders are NOT touched: a billed test can
-- never be removed or changed.
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
  -- FOR SHARE: the visit cannot move on while the order is being written.
  SELECT status::text AS status, doctor_profile_id INTO v
    FROM opd_visits WHERE tenant_id = NEW.tenant_id AND id = NEW.visit_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tests can only be ordered while the visit is in consultation' USING ERRCODE = '23514';
  END IF;
  IF v.doctor_profile_id <> NEW.doctor_profile_id THEN
    RAISE EXCEPTION 'tests are ordered by the doctor of the visit' USING ERRCODE = '23514';
  END IF;
  IF v.status = 'IN_CONSULTATION' THEN
    SELECT user_id INTO d FROM doctor_profiles WHERE tenant_id = NEW.tenant_id AND id = NEW.doctor_profile_id;
    IF NOT FOUND OR d.user_id <> NEW.ordered_by THEN
      RAISE EXCEPTION 'tests are ordered by the doctor of the visit' USING ERRCODE = '23514';
    END IF;
  ELSIF v.status = 'COMPLETED' AND current_setting('app.amend_tests', true) = 'on' THEN
    NULL; -- an amend of the completed note adds the test (ordered_by is the person who amended)
  ELSE
    RAISE EXCEPTION 'tests can only be ordered while the visit is in consultation' USING ERRCODE = '23514';
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
