-- Step 2.1f: the template library (owned by Indigo, assigned to hospitals), the logos of the library,
-- and the terminology overrides. The hospital login reads only what is assigned to it; only the
-- Indigo (HQ) login writes. Row level security is forced on every table.

-- A designed template of the library: one document type, a name, and the whole validated template.
CREATE TABLE "print_library_templates" (
  "id" TEXT NOT NULL,
  "doc_type" "print_doc_type" NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "input" JSONB NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retired_at" TIMESTAMPTZ(3),
  CONSTRAINT "print_library_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_library_templates_name_chk" CHECK (char_length("name") BETWEEN 1 AND 80),
  CONSTRAINT "print_library_templates_input_chk" CHECK (char_length("input"::text) <= 16000),
  CONSTRAINT "print_library_templates_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "hq_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "print_library_templates_key_key" ON "print_library_templates" ("key");
CREATE UNIQUE INDEX "print_library_templates_name_key" ON "print_library_templates" ("doc_type", "name") WHERE "retired_at" IS NULL;

-- A logo of the library (a small picture, kept in the database: it is a few kilobytes).
CREATE TABLE "print_library_logos" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_library_logos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_library_logos_type_chk" CHECK ("content_type" IN ('image/png', 'image/jpeg')),
  CONSTRAINT "print_library_logos_size_chk" CHECK ("byte_size" BETWEEN 1 AND 524288),
  CONSTRAINT "print_library_logos_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "hq_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "print_library_logos_name_key" ON "print_library_logos" ("name");

-- Which library entries a hospital may choose from (exactly one of template and logo per row).
CREATE TABLE "print_library_assignments" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "template_id" TEXT,
  "logo_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_library_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_library_assignments_one_chk" CHECK (("template_id" IS NULL) <> ("logo_id" IS NULL)),
  CONSTRAINT "print_library_assignments_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "print_library_assignments_template_fkey" FOREIGN KEY ("template_id") REFERENCES "print_library_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "print_library_assignments_logo_fkey" FOREIGN KEY ("logo_id") REFERENCES "print_library_logos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "print_library_assignments_template_key" ON "print_library_assignments" ("tenant_id", "template_id") WHERE "template_id" IS NOT NULL;
CREATE UNIQUE INDEX "print_library_assignments_logo_key" ON "print_library_assignments" ("tenant_id", "logo_id") WHERE "logo_id" IS NOT NULL;

-- Which library template a hospital template was chosen from (shown as the active one).
ALTER TABLE "print_templates" ADD COLUMN "library_template_id" TEXT;
ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_library_fkey"
  FOREIGN KEY ("library_template_id") REFERENCES "print_library_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The app role may change this one column (which library template is in use) like the other setting columns.
GRANT UPDATE ("library_template_id") ON TABLE "print_templates" TO hospigo_app;

-- The words a hospital prefers for a few terms (hospital, key, text); set by Indigo only.
CREATE TABLE "terminology_overrides" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "updated_by" TEXT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terminology_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminology_overrides_key_chk" CHECK ("key" ~ '^[a-z][a-zA-Z0-9]{0,39}$'),
  CONSTRAINT "terminology_overrides_text_chk" CHECK (char_length("text") BETWEEN 1 AND 60 AND "text" !~ '[<>]'),
  CONSTRAINT "terminology_overrides_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "hospitals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "terminology_overrides_key_key" ON "terminology_overrides" ("tenant_id", "key");

-- Row level security, forced, on every new table.
ALTER TABLE "print_library_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_library_templates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "print_library_logos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_library_logos" FORCE ROW LEVEL SECURITY;
ALTER TABLE "print_library_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_library_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "terminology_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "terminology_overrides" FORCE ROW LEVEL SECURITY;

-- Hospital login: read only what is assigned to its own hospital; never write.
CREATE POLICY print_library_assignments_app_select ON "print_library_assignments"
  FOR SELECT TO hospigo_app USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY print_library_templates_app_select ON "print_library_templates"
  FOR SELECT TO hospigo_app USING (EXISTS (
    SELECT 1 FROM "print_library_assignments" a
    WHERE a.template_id = "print_library_templates".id AND a.tenant_id = current_setting('app.tenant_id', true)));
CREATE POLICY print_library_logos_app_select ON "print_library_logos"
  FOR SELECT TO hospigo_app USING (EXISTS (
    SELECT 1 FROM "print_library_assignments" a
    WHERE a.logo_id = "print_library_logos".id AND a.tenant_id = current_setting('app.tenant_id', true)));
CREATE POLICY terminology_overrides_app_select ON "terminology_overrides"
  FOR SELECT TO hospigo_app USING (tenant_id = current_setting('app.tenant_id', true));

-- The hospital login holds no INSERT, UPDATE or DELETE right on these tables (the grants below), so these
-- policies only record the rule: a row of another hospital is never accepted.
CREATE POLICY print_library_assignments_app_insert ON "print_library_assignments"
  FOR INSERT TO hospigo_app WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY terminology_overrides_app_insert ON "terminology_overrides"
  FOR INSERT TO hospigo_app WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Indigo (HQ) login: the whole library and the assignments and terms of every hospital.
CREATE POLICY print_library_templates_hq_all ON "print_library_templates" FOR ALL TO hospigo_hq USING (true) WITH CHECK (true);
CREATE POLICY print_library_logos_hq_all ON "print_library_logos" FOR ALL TO hospigo_hq USING (true) WITH CHECK (true);
CREATE POLICY print_library_assignments_hq_all ON "print_library_assignments" FOR ALL TO hospigo_hq USING (true) WITH CHECK (true);
CREATE POLICY terminology_overrides_hq_all ON "terminology_overrides" FOR ALL TO hospigo_hq USING (true) WITH CHECK (true);

GRANT SELECT ON TABLE "print_library_templates", "print_library_logos", "print_library_assignments", "terminology_overrides" TO hospigo_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "print_library_templates" TO hospigo_hq;
GRANT SELECT, INSERT ON TABLE "print_library_logos" TO hospigo_hq;
GRANT SELECT, INSERT, DELETE ON TABLE "print_library_assignments" TO hospigo_hq;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "terminology_overrides" TO hospigo_hq;
GRANT ALL ON TABLE "print_library_templates", "print_library_logos", "print_library_assignments", "terminology_overrides" TO hospigo_owner;
