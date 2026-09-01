CREATE TABLE "fluid_memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"abstract_l0" text NOT NULL,
	"overview_l1" text NOT NULL,
	"source_message_id" uuid,
	"confidence" double precision NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_message_id" uuid,
	"operations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fluid_memory_items" ADD CONSTRAINT "fluid_memory_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluid_memory_items" ADD CONSTRAINT "fluid_memory_items_source_message_id_chat_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_diffs" ADD CONSTRAINT "memory_diffs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_diffs" ADD CONSTRAINT "memory_diffs_source_message_id_chat_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fluid_memory_items_workspace_status_idx" ON "fluid_memory_items" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "fluid_memory_items_workspace_kind_idx" ON "fluid_memory_items" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "memory_diffs_workspace_created_idx" ON "memory_diffs" USING btree ("workspace_id","created_at");