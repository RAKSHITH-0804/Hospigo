-- Step 2.1e: the Indigo console switches modules on for a hospital and its branches. The HQ login may
-- read the module catalog (global, no hospital data). It still cannot read any patient or clinical table.
GRANT SELECT ON TABLE "modules" TO hospigo_hq;
