ALTER TABLE project_folders ADD COLUMN IF NOT EXISTS parent_folder_id uuid REFERENCES project_folders(id);
CREATE INDEX IF NOT EXISTS project_folders_account_parent_idx ON project_folders(account_id, parent_folder_id);

ALTER TABLE library_folders ADD COLUMN IF NOT EXISTS parent_folder_id uuid REFERENCES library_folders(id);
CREATE INDEX IF NOT EXISTS library_folders_account_parent_idx ON library_folders(account_id, parent_folder_id);
