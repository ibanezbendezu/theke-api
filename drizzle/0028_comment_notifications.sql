ALTER TABLE public_share_comments ADD COLUMN resolved_at timestamptz;

CREATE TABLE comment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  comment_id uuid NOT NULL REFERENCES public_share_comments(id),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX comment_notifications_comment_uq ON comment_notifications(comment_id);
CREATE INDEX comment_notifications_account_created_idx ON comment_notifications(account_id, created_at DESC);

INSERT INTO comment_notifications (account_id, diagram_id, comment_id, created_at)
SELECT s.account_id, s.diagram_id, c.id, c.created_at
FROM public_share_comments c
JOIN diagram_shares s ON s.id = c.share_id
WHERE c.deleted_at IS NULL
ON CONFLICT (comment_id) DO NOTHING;
