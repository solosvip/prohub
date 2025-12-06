BEGIN;
WITH RECURSIVE
  ancestors(id, parent_id, type, effective_type) AS (
    SELECT id, parent_id, type, type FROM folders WHERE parent_id IS NULL
    UNION ALL
    SELECT f.id, f.parent_id, f.type,
           COALESCE(f.type, a.effective_type)
    FROM folders f
    JOIN ancestors a ON f.parent_id = a.id
  )
UPDATE folders AS t
SET type = (
  SELECT effective_type FROM ancestors WHERE ancestors.id = t.id
)
WHERE t.type IS NULL
  AND EXISTS (
    SELECT 1 FROM ancestors WHERE ancestors.id = t.id AND ancestors.effective_type IS NOT NULL
  );
COMMIT;
