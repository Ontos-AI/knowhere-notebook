INSERT INTO "demo_source_visibilities" (
  "workspace_id",
  "demo_source_id",
  "hidden_at",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  "workspace_id",
  "demo_key",
  "deleted_at",
  "deleted_at",
  now(),
  now()
FROM "sources"
WHERE
  "demo_key" IS NOT NULL
  AND "deleted_at" IS NOT NULL
ON CONFLICT ("workspace_id", "demo_source_id") DO UPDATE
SET
  "hidden_at" = EXCLUDED."hidden_at",
  "deleted_at" = EXCLUDED."deleted_at",
  "updated_at" = now();

UPDATE "sources"
SET
  "deleted_at" = now(),
  "updated_at" = now()
WHERE
  "demo_key" IS NOT NULL
  AND "deleted_at" IS NULL
  AND "knowhere_job_id" IS NULL
  AND (
    "knowhere_document_id" IS NULL
    OR "knowhere_document_id" LIKE 'demo-doc-%'
  );

UPDATE "sources"
SET
  "original_blob_pathname" = NULL,
  "original_blob_url" = '/api/demo-sources/' || "demo_key" || '/original',
  "updated_at" = now()
WHERE
  "demo_key" IS NOT NULL
  AND "deleted_at" IS NULL
  AND (
    "original_blob_url" IS NULL
    OR "original_blob_url" <> '/api/demo-sources/' || "demo_key" || '/original'
  );
