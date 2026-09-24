ALTER TABLE "resources" ADD COLUMN "archived_at" timestamptz;
ALTER TABLE "resources" ADD COLUMN "deleted_at" timestamptz;
ALTER TABLE "resources" ADD COLUMN "purge_after" timestamptz;
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamptz;
ALTER TABLE "projects" ADD COLUMN "purge_after" timestamptz;

CREATE TABLE "operation_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "idempotency_key" text NOT NULL,
  "entity_type" text NOT NULL CHECK ("entity_type" IN ('resource','project','folder')),
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL CHECK ("action" IN ('archive','delete')),
  "result" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE ("account_id", "idempotency_key")
);
CREATE INDEX "resources_account_lifecycle_idx" ON "resources" ("account_id", "archived_at", "deleted_at", "updated_at" DESC);
