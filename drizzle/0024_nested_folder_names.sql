DROP INDEX IF EXISTS project_folders_account_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS project_folders_account_root_name_uq ON project_folders(account_id, name) WHERE parent_folder_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_folders_account_parent_name_uq ON project_folders(account_id, parent_folder_id, name) WHERE parent_folder_id IS NOT NULL;

DROP INDEX IF EXISTS library_folders_account_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS library_folders_account_root_name_uq ON library_folders(account_id, name) WHERE parent_folder_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS library_folders_account_parent_name_uq ON library_folders(account_id, parent_folder_id, name) WHERE parent_folder_id IS NOT NULL;
