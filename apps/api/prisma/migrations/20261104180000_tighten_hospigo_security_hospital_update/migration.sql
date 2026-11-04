-- Step 3b-1 Part 1: hospigo_security may lock a hospital row (FOR UPDATE) but not mutate other columns.
REVOKE UPDATE ON TABLE hospitals FROM hospigo_security;
GRANT UPDATE (id) ON TABLE hospitals TO hospigo_security;
