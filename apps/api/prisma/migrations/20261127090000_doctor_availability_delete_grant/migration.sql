-- Step 8b part D: an Admin replaces a doctor weekly timetable and removes a leave period.
-- The application login gets DELETE on these two tables ONLY. Both stay under forced row level
-- security (policies doctor_timings_app_all and doctor_leave_app_all are FOR ALL and filter by tenant),
-- so a delete can only reach rows of the signed-in hospital. No other table, no other login.
GRANT DELETE ON TABLE doctor_timings, doctor_leave TO hospigo_app;
