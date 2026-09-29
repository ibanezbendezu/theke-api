BEGIN;

CREATE TEMP TABLE diagram_project_split ON COMMIT DROP AS
SELECT ranked.id AS diagram_id, ranked.project_id AS source_project_id,
  gen_random_uuid() AS new_project_id, ranked.name, ranked.archived_at, ranked.created_at
FROM (
  SELECT d.*, row_number() OVER (
    PARTITION BY d.project_id
    ORDER BY (d.archived_at IS NULL) DESC, d.created_at, d.id
  ) AS position
  FROM diagrams d
  WHERE d.deleted_at IS NULL
) ranked
WHERE ranked.position > 1;

INSERT INTO projects (id, account_id, name, collection_folder_id, archived_at, deleted_at, purge_after, created_at, updated_at)
SELECT split.new_project_id, source.account_id, split.name, source.collection_folder_id,
  COALESCE(split.archived_at, source.archived_at), source.deleted_at, source.purge_after,
  split.created_at, now()
FROM diagram_project_split split
JOIN projects source ON source.id = split.source_project_id;

CREATE TEMP TABLE diagram_folder_split ON COMMIT DROP AS
SELECT split.new_project_id, folder.id AS old_folder_id, gen_random_uuid() AS new_folder_id,
  folder.parent_folder_id, folder.name, folder.archived_at, folder.created_at, folder.updated_at
FROM diagram_project_split split
JOIN folders folder ON folder.project_id = split.source_project_id;

INSERT INTO folders (id, project_id, name, parent_folder_id, archived_at, created_at, updated_at)
SELECT new_folder_id, new_project_id, name, NULL, archived_at, created_at, updated_at
FROM diagram_folder_split;

UPDATE folders folder SET parent_folder_id = parent.new_folder_id
FROM diagram_folder_split child
JOIN diagram_folder_split parent ON parent.new_project_id = child.new_project_id
  AND parent.old_folder_id = child.parent_folder_id
WHERE folder.id = child.new_folder_id;

INSERT INTO project_resources (project_id, resource_id, folder_id, created_at, updated_at)
SELECT split.new_project_id, item.resource_id, folder.new_folder_id, item.created_at, item.updated_at
FROM diagram_project_split split
JOIN project_resources item ON item.project_id = split.source_project_id
LEFT JOIN diagram_folder_split folder ON folder.new_project_id = split.new_project_id
  AND folder.old_folder_id = item.folder_id;

UPDATE diagrams diagram SET
  project_id = split.new_project_id,
  document = jsonb_set(diagram.document, '{nodes}', COALESCE((
    SELECT jsonb_agg(CASE WHEN node.value->>'type' = 'folder' AND folder.new_folder_id IS NOT NULL
      THEN jsonb_set(jsonb_set(node.value, '{data,folderId}', to_jsonb(folder.new_folder_id::text)),
        '{data,projectId}', to_jsonb(split.new_project_id::text))
      ELSE node.value END ORDER BY node.ordinality)
    FROM jsonb_array_elements(diagram.document->'nodes') WITH ORDINALITY node(value, ordinality)
    LEFT JOIN diagram_folder_split folder ON folder.new_project_id = split.new_project_id
      AND folder.old_folder_id::text = node.value->'data'->>'folderId'
  ), '[]'::jsonb), true)
FROM diagram_project_split split
WHERE diagram.id = split.diagram_id;

UPDATE projects project SET name = kept.name, updated_at = now()
FROM (
  SELECT DISTINCT ON (diagram.project_id) diagram.project_id, diagram.name
  FROM diagrams diagram
  WHERE diagram.deleted_at IS NULL
  ORDER BY diagram.project_id, (diagram.archived_at IS NULL) DESC, diagram.created_at, diagram.id
) kept
WHERE project.id = kept.project_id
  AND EXISTS (SELECT 1 FROM diagram_project_split split WHERE split.source_project_id = project.id);

CREATE UNIQUE INDEX IF NOT EXISTS diagrams_project_live_uq ON diagrams(project_id)
WHERE deleted_at IS NULL;

COMMIT;
