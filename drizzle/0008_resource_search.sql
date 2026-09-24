CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "resources_title_search_idx" ON "resources" USING gin ("title" gin_trgm_ops);
