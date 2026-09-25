ALTER TABLE "relations"
  ADD COLUMN "label" text,
  ADD COLUMN "explanation" text,
  ADD COLUMN "provenance" text,
  ADD COLUMN "evidence_status" text NOT NULL DEFAULT 'none' CHECK ("evidence_status" IN ('none', 'needs_evidence', 'confirmed')),
  ADD COLUMN "revision" integer NOT NULL DEFAULT 0,
  ADD COLUMN "created_by_user_id" uuid REFERENCES "users"("id"),
  ADD COLUMN "updated_by_user_id" uuid REFERENCES "users"("id"),
  ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now();
CREATE TABLE "relation_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "relation_id" uuid NOT NULL REFERENCES "relations"("id"),
  "resource_id" uuid NOT NULL REFERENCES "resources"("id"),
  "excerpt" text,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "relation_evidence_relation_idx" ON "relation_evidence" ("relation_id");
