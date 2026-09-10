CREATE TABLE "retrieval_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"unit_type" text NOT NULL,
	"unit_ref" text NOT NULL,
	"activation_count" integer DEFAULT 0 NOT NULL,
	"last_activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fluid_memory_items" ADD COLUMN "deactivation_reason" text;--> statement-breakpoint
ALTER TABLE "retrieval_activations" ADD CONSTRAINT "retrieval_activations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_activations_unit_idx" ON "retrieval_activations" USING btree ("workspace_id","unit_type","unit_ref");