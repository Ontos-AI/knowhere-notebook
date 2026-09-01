CREATE TABLE "fluid_memory_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token" text NOT NULL,
	"frequency" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fluid_memory_tokens" ADD CONSTRAINT "fluid_memory_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluid_memory_tokens" ADD CONSTRAINT "fluid_memory_tokens_item_id_fluid_memory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."fluid_memory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fluid_memory_tokens_lookup_idx" ON "fluid_memory_tokens" USING btree ("workspace_id","kind","token");--> statement-breakpoint
CREATE INDEX "fluid_memory_tokens_item_idx" ON "fluid_memory_tokens" USING btree ("item_id");