CREATE TABLE "resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "author_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "type" text NOT NULL CHECK ("type" IN ('note')),
  "title" text NOT NULL CHECK (char_length(btrim("title")) BETWEEN 1 AND 160),
  "description" text,
  "creation_method" text NOT NULL CHECK ("creation_method" IN ('manual')),
  "current_version_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "resource_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "author_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "ordinal" integer NOT NULL CHECK ("ordinal" > 0),
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE ("resource_id", "ordinal")
);
ALTER TABLE "resources" ADD CONSTRAINT "resources_current_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "resource_versions"("id");
CREATE INDEX "resources_account_updated_idx" ON "resources" ("account_id", "type", "updated_at" DESC, "id" DESC);
