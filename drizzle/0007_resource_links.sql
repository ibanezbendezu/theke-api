ALTER TABLE "resources" DROP CONSTRAINT "resources_type_check";
ALTER TABLE "resources" ADD CONSTRAINT "resources_type_check" CHECK ("type" IN ('note', 'file', 'link'));

CREATE TABLE "resource_links" (
  "resource_id" uuid PRIMARY KEY REFERENCES "resources"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "preview_image_url" text,
  "metadata_status" text NOT NULL CHECK ("metadata_status" IN ('pending', 'ready', 'failed')),
  "metadata_failure" text,
  "requested_at" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
