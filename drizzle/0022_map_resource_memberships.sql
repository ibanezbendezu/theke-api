INSERT INTO project_resources (project_id, resource_id)
SELECT DISTINCT diagram.project_id, resource.id
FROM diagrams diagram
JOIN projects project ON project.id = diagram.project_id
CROSS JOIN LATERAL jsonb_array_elements(diagram.document->'nodes') node
JOIN resources resource ON resource.id::text = node->'data'->>'resourceId'
  AND resource.account_id = project.account_id AND resource.deleted_at IS NULL
WHERE diagram.deleted_at IS NULL AND project.deleted_at IS NULL
ON CONFLICT (project_id, resource_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS project_resources_resource_idx ON project_resources(resource_id);
