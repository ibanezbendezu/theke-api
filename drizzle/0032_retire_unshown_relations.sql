-- Historical revisions retain these rows for recovery, but a relationship absent
-- from the current map must not reappear as an active suggestion.
UPDATE relations relation
SET deleted_at = now(), purge_after = now() + interval '30 days', updated_at = now()
WHERE relation.diagram_id IS NOT NULL
  AND relation.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM diagrams diagram
    CROSS JOIN LATERAL jsonb_array_elements(diagram.document->'edges') AS edge(value)
    WHERE diagram.id = relation.diagram_id
      AND edge.value->'data'->>'relationId' = relation.id::text
  );

CREATE INDEX "relations_diagram_active_idx" ON "relations" ("diagram_id")
WHERE "deleted_at" IS NULL AND "archived_at" IS NULL;
