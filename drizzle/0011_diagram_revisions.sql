ALTER TABLE "diagrams" ADD COLUMN "revision" integer NOT NULL DEFAULT 0;
CREATE TABLE "diagram_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "diagram_id" uuid NOT NULL REFERENCES "diagrams"("id"),
  "revision" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "document" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "diagram_revisions_diagram_revision_uq" UNIQUE ("diagram_id", "revision"),
  CONSTRAINT "diagram_revisions_diagram_key_uq" UNIQUE ("diagram_id", "idempotency_key")
);
