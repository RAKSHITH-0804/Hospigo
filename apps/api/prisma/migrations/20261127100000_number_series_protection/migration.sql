-- Step 8c: the bill, receipt and refund numbers can never repeat or go back.
--
-- Already in place since Step 3a/4a: number_series.last_number can only move forward (trigger
-- number_series_forward_only) and a bill, receipt or refund number is unique per hospital.
-- What was still possible (for the owner login, or by a future route): deleting or emptying a
-- counter row, or moving it to another period, which would restart the count and repeat numbers.
-- And the screen now lets an Admin change the format, so the two settings that decide the counter
-- period are locked in the database as well, not only in the API.

-- 1. A counter row can never be deleted or emptied (every login, the owner included).
--    Reuses the refuse functions of the OPD price tables, as Step 7f did for uhid_counters.
CREATE TRIGGER number_series_refuse_delete
  BEFORE DELETE ON number_series
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER number_series_refuse_truncate
  BEFORE TRUNCATE ON number_series
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- 2. The key of a counter (hospital, series, period) never changes: only last_number moves, forward.
CREATE OR REPLACE FUNCTION refuse_number_series_key_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.tenant_id, NEW.series, NEW.period_year) IS DISTINCT FROM
     (OLD.tenant_id, OLD.series, OLD.period_year) THEN
    RAISE EXCEPTION 'a number series counter keeps its hospital, series and period' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER number_series_keys_frozen
  BEFORE UPDATE ON number_series
  FOR EACH ROW EXECUTE FUNCTION refuse_number_series_key_change();

-- 3. The reset rule and the financial-year start month decide the counter period. Once any number
--    of the series exists they cannot change (a change would start a new count and repeat numbers).
--    The check reads number_series as the caller (row level security shows the caller's hospital),
--    and only runs when one of the two values really changes.
CREATE OR REPLACE FUNCTION number_series_settings_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.reset_rule, NEW.fy_start_month) IS DISTINCT FROM (OLD.reset_rule, OLD.fy_start_month) THEN
    IF EXISTS (
      SELECT 1 FROM number_series ns
       WHERE ns.tenant_id = OLD.tenant_id AND ns.series = OLD.series
    ) THEN
      RAISE EXCEPTION 'the reset rule and the financial year start of a series cannot change after its first number'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER number_series_settings_guard_update
  BEFORE UPDATE ON number_series_settings
  FOR EACH ROW EXECUTE FUNCTION number_series_settings_guard_update();
