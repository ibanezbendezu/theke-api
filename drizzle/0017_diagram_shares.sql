CREATE TABLE "diagram_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "diagram_id" uuid NOT NULL REFERENCES "diagrams"("id"),
  "token_hash" text NOT NULL UNIQUE,
  "idempotency_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "projection" jsonb NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "diagram_shares_account_key_uq" UNIQUE ("account_id", "idempotency_key")
);
CREATE UNIQUE INDEX "diagram_shares_active_diagram_uq" ON "diagram_shares" ("diagram_id") WHERE "revoked_at" IS NULL;
