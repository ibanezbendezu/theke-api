CREATE TABLE "folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "name" text NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  "parent_folder_id" uuid REFERENCES "folders"("id"),
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CHECK ("parent_folder_id" IS NULL OR "parent_folder_id" <> "id")
);
CREATE TABLE "project_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "folder_id" uuid REFERENCES "folders"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE ("project_id", "resource_id")
);
CREATE INDEX "folders_project_active_idx" ON "folders" ("project_id", "archived_at", "name");
CREATE INDEX "project_resources_project_folder_idx" ON "project_resources" ("project_id", "folder_id");
