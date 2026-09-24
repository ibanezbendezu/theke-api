CREATE TABLE "resource_accessibility" (
  "resource_id" uuid PRIMARY KEY REFERENCES "resources"("id") ON DELETE CASCADE,
  "text" text NOT NULL CHECK (char_length("text") <= 2000),
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
