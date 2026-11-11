-- Password lifecycle flags for hospital users and HQ users.
-- Default must_change_password = true for new accounts; seeds may set false for local demo users.

ALTER TABLE "users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3);

ALTER TABLE "hq_users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3);
