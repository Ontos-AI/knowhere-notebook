CREATE TABLE "source_parse_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"result_blob_url" text NOT NULL,
	"asset_urls" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_parse_results_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "source_parse_results" ADD CONSTRAINT "source_parse_results_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_parse_results_source_id_idx" ON "source_parse_results" USING btree ("source_id");
