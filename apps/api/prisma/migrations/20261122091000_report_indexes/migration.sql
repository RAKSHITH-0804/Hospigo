-- Phase 2 Step 7-1: indexes for the daily collection report.
--
-- The report adds up one day (midnight to midnight in the hospital time zone) of payments, refunds,
-- ledger rows and visits for one branch or all branches. Without these indexes every report would
-- read the whole money history of the hospital. Indexes change no data and no rule.

CREATE INDEX "payments_branch_paid_at_idx" ON "payments"("tenant_id", "branch_id", "paid_at");
CREATE INDEX "refunds_branch_refunded_at_idx" ON "refunds"("tenant_id", "branch_id", "refunded_at");
CREATE INDEX "ledger_entries_branch_posted_idx" ON "ledger_entries"("tenant_id", "branch_id", "posted_at");
CREATE INDEX "opd_visits_branch_date_idx" ON "opd_visits"("tenant_id", "branch_id", "visit_date");
