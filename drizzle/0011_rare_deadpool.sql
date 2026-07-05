ALTER TABLE "source_parse_results" ALTER COLUMN "result_blob_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_parse_results" ADD COLUMN "revision_key" text;--> statement-breakpoint
ALTER TABLE "source_parse_results" ADD COLUMN "sync_status" text;--> statement-breakpoint
ALTER TABLE "source_parse_results" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "failure_stage" text;