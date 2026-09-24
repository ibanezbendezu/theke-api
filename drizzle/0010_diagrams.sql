CREATE TABLE "diagrams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "name" text NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  "document" jsonb NOT NULL,
  "archived_at" timestamptz,
  "deleted_at" timestamptz,
  "purge_after" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "diagrams_project_lifecycle_idx" ON "diagrams" ("project_id", "archived_at", "deleted_at", "updated_at" DESC);

ALTER TABLE "operation_receipts" DROP CONSTRAINT "operation_receipts_entity_type_check";
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_entity_type_check" CHECK ("entity_type" IN ('resource','project','folder','diagram'));
