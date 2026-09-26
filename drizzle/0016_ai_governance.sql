CREATE TABLE "account_ai_settings" (
  "account_id" uuid PRIMARY KEY REFERENCES "accounts"("id"),
  "enabled" boolean NOT NULL DEFAULT false,
  "provider" text NOT NULL DEFAULT 'openai',
  "model" text NOT NULL DEFAULT 'gpt-5.6-terra',
  "accepted_consent_version" text,
  "consented_at" timestamptz,
  "consented_by_user_id" uuid REFERENCES "users"("id"),
  "max_input_tokens" integer NOT NULL DEFAULT 50000,
  "max_output_tokens" integer NOT NULL DEFAULT 4000,
  "daily_runs_limit" integer NOT NULL DEFAULT 10,
  "monthly_budget_usd" numeric(10,2) NOT NULL DEFAULT 5.00,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "ai_usage_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "feature" text NOT NULL,
  "consent_version" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "estimated_cost_usd" numeric(10,4) NOT NULL DEFAULT 0,
  "status" text NOT NULL CHECK ("status" IN ('success', 'failed', 'blocked_quota', 'rejected')),
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "ai_usage_records_account_created_idx" ON "ai_usage_records" ("account_id", "created_at");
