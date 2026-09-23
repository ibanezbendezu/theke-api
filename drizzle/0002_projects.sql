CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "name" text NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "projects_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120)
);
CREATE INDEX "projects_account_active_page_idx" ON "projects" ("account_id", "archived_at", "created_at" DESC, "id" DESC);
