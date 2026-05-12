UPDATE "sources"
SET
  "deleted_at" = now(),
  "updated_at" = now()
WHERE
  "demo_key" IS NOT NULL
  AND "deleted_at" IS NULL
  AND "status" = 'ready'
  AND "knowhere_job_id" IS NULL
  AND "knowhere_document_id" LIKE 'demo-doc-%';

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
