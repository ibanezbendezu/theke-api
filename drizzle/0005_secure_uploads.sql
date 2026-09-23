ALTER TABLE "resource_versions" ADD COLUMN "storage_key" text;
ALTER TABLE "resource_versions" ADD COLUMN "media_type" text;
ALTER TABLE "resource_versions" ADD COLUMN "byte_size" bigint;
ALTER TABLE "resources" DROP CONSTRAINT "resources_type_check";
ALTER TABLE "resources" ADD CONSTRAINT "resources_type_check" CHECK ("type" IN ('note', 'file'));

CREATE TABLE "uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "idempotency_key" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('initiated','finalizing','uploaded','scanning','ready','rejected','failed','cancelled')),
  "original_name" text NOT NULL,
  "declared_media_type" text NOT NULL,
  "declared_size" bigint NOT NULL CHECK ("declared_size" > 0 AND "declared_size" <= 262144000),
  "quarantine_key" text NOT NULL UNIQUE,
  "snapshot_key" text UNIQUE,
  "clean_key" text,
  "etag" text,
  "sha256" text,
  "detected_media_type" text,
  "failure_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE ("account_id", "idempotency_key")
);
CREATE INDEX "uploads_account_status_idx" ON "uploads" ("account_id", "status", "created_at");
