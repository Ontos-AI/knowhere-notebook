CREATE TABLE "demo_source_visibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"demo_source_id" text NOT NULL,
	"hidden_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_source_visibilities" ADD CONSTRAINT "demo_source_visibilities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "demo_source_visibilities_workspace_source_idx" ON "demo_source_visibilities" USING btree ("workspace_id","demo_source_id");
--> statement-breakpoint
CREATE INDEX "demo_source_visibilities_workspace_idx" ON "demo_source_visibilities" USING btree ("workspace_id");
