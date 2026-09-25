ALTER TABLE "resources" ADD COLUMN "aliases" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "resources" ADD COLUMN "tags" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "resources" ADD COLUMN "properties" jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE "resource_property_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "key" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('text','list','number','checkbox','date','datetime')),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "resource_property_definitions_account_key_uq" ON "resource_property_definitions" ("account_id", "key");
CREATE TABLE "resource_mentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "source_version_id" uuid NOT NULL REFERENCES "resource_versions"("id"),
  "target_resource_id" uuid REFERENCES "resources"("id"),
  "raw_target" text NOT NULL,
  "display_text" text,
  "anchor" text,
  "start_offset" integer NOT NULL,
  "end_offset" integer NOT NULL,
  "resolution" text NOT NULL CHECK ("resolution" IN ('linked','unresolved','ambiguous'))
);
CREATE UNIQUE INDEX "resource_mentions_source_version_start_uq" ON "resource_mentions" ("source_version_id", "start_offset");
CREATE INDEX "resource_mentions_target_idx" ON "resource_mentions" ("target_resource_id", "source_version_id");
ALTER TABLE "relation_evidence" ADD COLUMN "resource_version_id" uuid REFERENCES "resource_versions"("id");
ALTER TABLE "relation_evidence" ADD COLUMN "start_offset" integer;
ALTER TABLE "relation_evidence" ADD COLUMN "end_offset" integer;
ALTER TABLE "relation_evidence" ADD COLUMN "page_number" integer;
UPDATE "relation_evidence" e SET "resource_version_id" = r."current_version_id" FROM "resources" r WHERE e."resource_id" = r."id";
