ALTER TABLE public_share_comments ADD COLUMN author_user_id uuid REFERENCES users(id);
CREATE INDEX public_share_comments_author_idx ON public_share_comments(share_id, author_user_id) WHERE author_user_id IS NOT NULL;
