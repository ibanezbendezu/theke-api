ALTER TABLE "diagram_shares" ADD COLUMN IF NOT EXISTS "comments_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "diagram_share_events" DROP CONSTRAINT IF EXISTS "diagram_share_events_action_check";
ALTER TABLE "diagram_share_events" ADD CONSTRAINT "diagram_share_events_action_check" CHECK ("action" IN ('published', 'retried', 'refreshed', 'comments_changed', 'revoked'));
