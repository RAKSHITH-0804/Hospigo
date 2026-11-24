-- Step 8c: doctor leave requests with approval by an Admin.
--
-- A doctor asks for leave, an Admin (SuperAdmin, or the Branch Admin of the branch the doctor works
-- in) approves or rejects it. Only an APPROVED request creates the leave (the existing doctor_leave
-- table, through the API), so a request that is only waiting never blocks anything. A request is
-- history: it is closed (approved, rejected or cancelled), never edited and never deleted.

CREATE TYPE "leave_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "doctor_leave_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_profile_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "status" "leave_request_status" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- who closed it (an Admin for approved or rejected, the doctor for cancelled) and when
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    -- the leave an approval created (a plain id: an Admin may remove that leave later)
    "leave_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_leave_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doctor_leave_requests_dates_chk" CHECK ("to_date" >= "from_date"),
    CONSTRAINT "doctor_leave_requests_decision_chk" CHECK (
      ("status" = 'PENDING' AND "decided_by" IS NULL AND "decided_at" IS NULL)
      OR ("status" <> 'PENDING' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "doctor_leave_requests_tenant_id_id_key" ON "doctor_leave_requests"("tenant_id", "id");
CREATE INDEX "doctor_leave_requests_tenant_id_doctor_profile_id_status_idx"
  ON "doctor_leave_requests"("tenant_id", "doctor_profile_id", "status");
CREATE INDEX "doctor_leave_requests_tenant_id_status_requested_at_idx"
  ON "doctor_leave_requests"("tenant_id", "status", "requested_at");

ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_tenant_id_doctor_profile_id_fkey"
  FOREIGN KEY ("tenant_id", "doctor_profile_id") REFERENCES "doctor_profiles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_tenant_id_requested_by_fkey"
  FOREIGN KEY ("tenant_id", "requested_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_tenant_id_decided_by_fkey"
  FOREIGN KEY ("tenant_id", "decided_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security: a hospital sees only its own requests (forced, the owner login too).
ALTER TABLE "doctor_leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_leave_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY doctor_leave_requests_app_all ON doctor_leave_requests
  FOR ALL TO hospigo_app
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Grants: read, add, close. No DELETE. hospigo_hq and hospigo_patient get nothing.
GRANT SELECT, INSERT, UPDATE ON TABLE doctor_leave_requests TO hospigo_app;
GRANT ALL ON TABLE doctor_leave_requests TO hospigo_owner;

-- A request is never deleted or emptied (every login, the owner included).
CREATE TRIGGER doctor_leave_requests_refuse_delete
  BEFORE DELETE ON doctor_leave_requests
  FOR EACH ROW EXECUTE FUNCTION refuse_opd_price_mutation();
CREATE TRIGGER doctor_leave_requests_refuse_truncate
  BEFORE TRUNCATE ON doctor_leave_requests
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_opd_price_truncate();

-- A request keeps its hospital, doctor, days and requester; it can only be CLOSED once, from PENDING
-- to APPROVED, REJECTED or CANCELLED. A closed request never changes again.
CREATE OR REPLACE FUNCTION doctor_leave_requests_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.doctor_profile_id, NEW.from_date, NEW.to_date, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.doctor_profile_id, OLD.from_date, OLD.to_date, OLD.requested_by, OLD.requested_at) THEN
    RAISE EXCEPTION 'a leave request keeps its doctor, days and requester' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'a decided leave request cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'nothing changed: a leave request can only be closed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER doctor_leave_requests_guard_update
  BEFORE UPDATE ON doctor_leave_requests
  FOR EACH ROW EXECUTE FUNCTION doctor_leave_requests_guard_update();
