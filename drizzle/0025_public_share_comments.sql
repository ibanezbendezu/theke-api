CREATE TABLE public_share_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES diagram_shares(id),
  owner_hash text NOT NULL,
  ip_hash text NOT NULL,
  display_name text NOT NULL,
  content text NOT NULL,
  anchor jsonb NOT NULL DEFAULT '{"type":"diagram"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_share_comments_share_created_idx ON public_share_comments(share_id, created_at);
CREATE INDEX public_share_comments_owner_idx ON public_share_comments(share_id, owner_hash);
