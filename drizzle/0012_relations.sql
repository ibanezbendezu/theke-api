CREATE TABLE "relation_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "origin_project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "label" text NOT NULL,
  "label_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "relation_types_project_label_uq" UNIQUE ("origin_project_id", "label_key")
);
CREATE TABLE "relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "source_resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "target_resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "direction" text NOT NULL CHECK ("direction" IN ('directed', 'undirected')),
  "type_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "relations_equivalent_uq" UNIQUE ("account_id", "source_resource_id", "target_resource_id", "direction", "type_key")
);
