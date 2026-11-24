-- Step 9 (A1): the application login must never delete a person. Staff are deactivated (is_active),
-- never deleted, and nothing in the code deletes users. The grant came from the first migration.
-- Owner login (migrations, tests) is unchanged; INSERT, SELECT and UPDATE stay for the app.
REVOKE DELETE ON TABLE users FROM hospigo_app;
