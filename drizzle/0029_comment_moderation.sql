ALTER TABLE public_share_comments
  ADD COLUMN orphaned_at timestamptz,
  ADD COLUMN purge_after timestamptz;

UPDATE public_share_comments
SET orphaned_at = now()
WHERE jsonb_typeof(anchor -> 'x') IS DISTINCT FROM 'number'
   OR jsonb_typeof(anchor -> 'y') IS DISTINCT FROM 'number';

CREATE TABLE comment_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  comment_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('resolved', 'reopened', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comment_moderation_events_account_created_idx
  ON comment_moderation_events(account_id, created_at DESC);

CREATE INDEX public_share_comments_purge_after_idx
  ON public_share_comments(purge_after)
  WHERE purge_after IS NOT NULL;
