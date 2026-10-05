ALTER TABLE "relations" ADD COLUMN "diagram_id" uuid REFERENCES "diagrams"("id");
ALTER TABLE "relations" DROP CONSTRAINT IF EXISTS "relations_equivalent_uq";
DROP INDEX IF EXISTS "relations_equivalent_uq";

-- Preserve every map's relation details, including relations referenced by saved revisions.
CREATE TEMP TABLE _map_relations ON COMMIT DROP AS
WITH referenced_relations AS (
  SELECT d.id AS diagram_id, (edge.value->'data'->>'relationId')::uuid AS old_id
  FROM diagrams d CROSS JOIN LATERAL jsonb_array_elements(d.document->'edges') AS edge(value)
  WHERE edge.value->'data'->>'relationId' IS NOT NULL
  UNION
  SELECT r.diagram_id, (edge.value->'data'->>'relationId')::uuid AS old_id
  FROM diagram_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.document->'edges') AS edge(value)
  WHERE edge.value->'data'->>'relationId' IS NOT NULL
), ranked AS (
  SELECT ref.diagram_id, ref.old_id,
         row_number() OVER (PARTITION BY ref.old_id ORDER BY ref.diagram_id) AS position
  FROM referenced_relations ref JOIN relations relation ON relation.id = ref.old_id
)
SELECT diagram_id, old_id,
       CASE WHEN position = 1 THEN old_id ELSE gen_random_uuid() END AS new_id,
       position
FROM ranked;

UPDATE relations relation SET diagram_id = mapping.diagram_id
FROM _map_relations mapping
WHERE relation.id = mapping.old_id AND mapping.position = 1;

INSERT INTO relations (id, account_id, diagram_id, source_resource_id, target_resource_id,
  direction, type_key, label, explanation, provenance, evidence_status, revision,
  archived_at, deleted_at, purge_after, created_by_user_id, updated_by_user_id, created_at, updated_at)
SELECT mapping.new_id, relation.account_id, mapping.diagram_id, relation.source_resource_id,
  relation.target_resource_id, relation.direction, relation.type_key, relation.label,
  relation.explanation, relation.provenance, relation.evidence_status, relation.revision,
  relation.archived_at, relation.deleted_at, relation.purge_after,
  relation.created_by_user_id, relation.updated_by_user_id, relation.created_at, relation.updated_at
FROM _map_relations mapping JOIN relations relation ON relation.id = mapping.old_id
WHERE mapping.position > 1;

INSERT INTO relation_evidence (relation_id, resource_id, resource_version_id,
  start_offset, end_offset, page_number, excerpt, note, created_at)
SELECT mapping.new_id, evidence.resource_id, evidence.resource_version_id,
  evidence.start_offset, evidence.end_offset, evidence.page_number, evidence.excerpt,
  evidence.note, evidence.created_at
FROM _map_relations mapping JOIN relation_evidence evidence ON evidence.relation_id = mapping.old_id
WHERE mapping.position > 1;

UPDATE diagrams d SET document = jsonb_set(d.document, '{edges}', (
  SELECT jsonb_agg(CASE WHEN mapping.position > 1
    THEN jsonb_set(edge.value, '{data,relationId}', to_jsonb(mapping.new_id::text))
    ELSE edge.value END ORDER BY edge.ordinality)
  FROM jsonb_array_elements(d.document->'edges') WITH ORDINALITY AS edge(value, ordinality)
  LEFT JOIN _map_relations mapping ON mapping.diagram_id = d.id
    AND mapping.old_id::text = edge.value->'data'->>'relationId'
)) WHERE EXISTS (SELECT 1 FROM _map_relations mapping WHERE mapping.diagram_id = d.id AND mapping.position > 1);

UPDATE diagram_revisions r SET document = jsonb_set(r.document, '{edges}', (
  SELECT jsonb_agg(CASE WHEN mapping.position > 1
    THEN jsonb_set(edge.value, '{data,relationId}', to_jsonb(mapping.new_id::text))
    ELSE edge.value END ORDER BY edge.ordinality)
  FROM jsonb_array_elements(r.document->'edges') WITH ORDINALITY AS edge(value, ordinality)
  LEFT JOIN _map_relations mapping ON mapping.diagram_id = r.diagram_id
    AND mapping.old_id::text = edge.value->'data'->>'relationId'
)) WHERE EXISTS (SELECT 1 FROM _map_relations mapping WHERE mapping.diagram_id = r.diagram_id AND mapping.position > 1);

CREATE UNIQUE INDEX "relations_equivalent_uq"
  ON "relations" ("diagram_id", "source_resource_id", "target_resource_id", "direction", "type_key")
  WHERE "deleted_at" IS NULL;
