-- Step 9 (A1): the application login must never delete a person, a hospital, a branch or a role.
-- Staff, roles, role permissions, assignments and branch links are switched off (is_active), never
-- deleted, and nothing in the code deletes these rows (checked: no delete, deleteMany or raw
-- DELETE on them outside tests). The broad grant came from the first migration. The owner login
-- (migrations, tests) is unchanged; SELECT, INSERT and UPDATE stay for the app. Tables the app does
-- delete from on purpose (doctor_leave, doctor_timings, print_templates, prescription_items,
-- investigation_orders, auth_sessions) keep their grant.
REVOKE DELETE ON TABLE
  users, hospitals, hospital_settings, hospital_module_subscriptions, branch_modules, branches,
  roles, role_permissions, role_assignments, role_assignment_branches, user_branches
  FROM hospigo_app;
