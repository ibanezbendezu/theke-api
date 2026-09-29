CREATE TABLE IF NOT EXISTS library_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS library_folders_account_name_uq ON library_folders(account_id, name);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS library_folder_id uuid REFERENCES library_folders(id);
CREATE INDEX IF NOT EXISTS resources_account_library_folder_idx ON resources(account_id, library_folder_id);
CREATE TABLE IF NOT EXISTS project_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_folders_account_name_uq ON project_folders(account_id, name);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS collection_folder_id uuid REFERENCES project_folders(id);
CREATE INDEX IF NOT EXISTS projects_account_collection_folder_idx ON projects(account_id, collection_folder_id);
