CREATE TABLE "parsed_document_sync_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"revision_key" text,
	"lease_token" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parsed_document_sync_leases" ADD CONSTRAINT "parsed_document_sync_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsed_document_sync_leases" ADD CONSTRAINT "parsed_document_sync_leases_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parsed_document_sync_leases_token_idx" ON "parsed_document_sync_leases" USING btree ("lease_token");--> statement-breakpoint
CREATE INDEX "parsed_document_sync_leases_active_idx" ON "parsed_document_sync_leases" USING btree ("expires_at") WHERE released_at IS NULL;--> statement-breakpoint
CREATE INDEX "parsed_document_sync_leases_workspace_active_idx" ON "parsed_document_sync_leases" USING btree ("workspace_id") WHERE released_at IS NULL;--> statement-breakpoint
CREATE INDEX "parsed_document_sync_leases_document_active_idx" ON "parsed_document_sync_leases" USING btree ("document_id") WHERE released_at IS NULL;