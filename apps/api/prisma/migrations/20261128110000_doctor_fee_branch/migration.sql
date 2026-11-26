-- Step 9 (B): per-branch doctor fees.
-- A doctor fee row may now belong to one branch (branch_id) or, with branch_id NULL, to the whole
-- hospital (every existing row stays valid and unchanged). Rows stay append-only versions with an
-- effective date: the existing triggers already refuse UPDATE, DELETE and TRUNCATE, so nothing
-- about a fee row (including its branch) can change after it is written. Row level security is
-- unchanged (hospital), grants are unchanged (SELECT, INSERT only), the composite foreign key
-- keeps a fee inside its own hospital's branches. NULL branch_id is skipped by the foreign key.
ALTER TABLE "doctor_fees" ADD COLUMN "branch_id" TEXT;

ALTER TABLE "doctor_fees" ADD CONSTRAINT "doctor_fees_branch_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branches"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- one version per doctor, visit type, scope (hospital-wide or one branch) and start moment
DROP INDEX "doctor_fees_tenant_doctor_type_from_key";
CREATE UNIQUE INDEX "doctor_fees_scope_from_key"
  ON "doctor_fees" ("tenant_id", "doctor_profile_id", "visit_type", COALESCE("branch_id", ''), "effective_from");

-- the branch lookup at billing time
CREATE INDEX "doctor_fees_branch_lookup_idx"
  ON "doctor_fees" ("tenant_id", "branch_id", "doctor_profile_id", "visit_type", "effective_from")
  WHERE "branch_id" IS NOT NULL;
