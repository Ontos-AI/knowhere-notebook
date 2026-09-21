CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_workspace_parent_idx" ON "folders" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_workspace_parent_name_idx" ON "folders" USING btree ("workspace_id","parent_id","name") WHERE deleted_at IS NULL AND parent_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_workspace_root_name_idx" ON "folders" USING btree ("workspace_id","name") WHERE deleted_at IS NULL AND parent_id IS NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sources_workspace_folder_idx" ON "sources" USING btree ("workspace_id","folder_id") WHERE deleted_at IS NULL;