-- Step 7f: stored_images and uhid_counters could only not be deleted because the application login
-- has no DELETE grant. Add real DELETE and TRUNCATE blocking triggers (they fire for the owner role
-- too). uhid_counters keeps its raise-only UPDATE (the 3a decrease trigger is untouched).
-- Reuses the refuse functions of the OPD price tables.

CREATE TRIGGER stored_images_refuse_delete
  BEFORE DELETE ON stored_images
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER stored_images_refuse_truncate
  BEFORE TRUNCATE ON stored_images
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

CREATE TRIGGER uhid_counters_refuse_delete
  BEFORE DELETE ON uhid_counters
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER uhid_counters_refuse_truncate
  BEFORE TRUNCATE ON uhid_counters
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();
