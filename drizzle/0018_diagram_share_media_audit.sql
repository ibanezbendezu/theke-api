ALTER TABLE "diagram_shares" ADD COLUMN IF NOT EXISTS "media_manifest" jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS "diagram_share_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "diagram_id" uuid NOT NULL REFERENCES "diagrams"("id"),
  "share_id" uuid NOT NULL REFERENCES "diagram_shares"("id"),
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "action" text NOT NULL CHECK ("action" IN ('published', 'retried')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "diagram_share_events_share_created_idx" ON "diagram_share_events" ("share_id", "created_at");
