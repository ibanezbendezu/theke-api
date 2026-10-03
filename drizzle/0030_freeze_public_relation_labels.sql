ALTER TABLE diagram_shares
  ADD COLUMN relation_labels_frozen_at timestamptz;

UPDATE diagram_shares AS share
SET projection = jsonb_set(
      share.projection,
      '{relations}',
      (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN jsonb_typeof(entry.relation) <> 'object' OR entry.relation ? 'typeLabel' THEN entry.relation
            ELSE entry.relation || jsonb_build_object('typeLabel',
              CASE entry.relation ->> 'typeKey'
                WHEN 'supports' THEN 'Respalda'
                WHEN 'contradicts' THEN 'Contradice'
                WHEN 'depends_on' THEN 'Depende de'
                WHEN 'related_to' THEN 'Se relaciona con'
                ELSE COALESCE(
                  (SELECT type.label FROM relation_types AS type
                    WHERE type.account_id = share.account_id
                      AND type.id::text = substring(entry.relation ->> 'typeKey' from 8)
                      AND entry.relation ->> 'typeKey' LIKE 'custom:%'
                    LIMIT 1),
                  'Relación')
              END)
          END ORDER BY entry.ordinality), '[]'::jsonb)
        FROM jsonb_array_elements(share.projection -> 'relations') WITH ORDINALITY AS entry(relation, ordinality)
      ),
      true),
    relation_labels_frozen_at = now()
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(share.projection -> 'relations') AS relation
  WHERE jsonb_typeof(relation) = 'object' AND NOT (relation ? 'typeLabel')
);
