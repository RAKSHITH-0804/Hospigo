-- Step 9 (A5): the bills of one visit (tests billing, consultation screen) were found by scanning the
-- whole table for every bill type except the consultation bill. Measured on 700k synthetic bills:
-- 160 ms without this index, 0.06 ms with it. No data change.
CREATE INDEX "bills_visit_idx" ON "bills" ("tenant_id", "visit_id");
