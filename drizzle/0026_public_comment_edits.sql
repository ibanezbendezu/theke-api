ALTER TABLE public_share_comments ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE public_share_comments ADD COLUMN edited_at timestamptz;
ALTER TABLE public_share_comments ADD COLUMN deleted_at timestamptz;

CREATE TABLE public_share_comment_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES diagram_shares(id),
  comment_id uuid NOT NULL REFERENCES public_share_comments(id),
  owner_hash text NOT NULL,
  ip_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'edited')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_share_comment_mutations_share_time_idx ON public_share_comment_mutations(share_id, created_at);
CREATE INDEX public_share_comment_mutations_owner_time_idx ON public_share_comment_mutations(owner_hash, created_at);
CREATE INDEX public_share_comment_mutations_ip_time_idx ON public_share_comment_mutations(ip_hash, created_at);

INSERT INTO public_share_comment_mutations (share_id, comment_id, owner_hash, ip_hash, action, created_at)
SELECT share_id, id, owner_hash, ip_hash, 'created', created_at FROM public_share_comments;
