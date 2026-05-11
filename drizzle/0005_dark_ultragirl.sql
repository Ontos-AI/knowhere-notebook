ALTER TABLE "chat_threads" ADD COLUMN "demo_key" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "demo_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_workspace_demo_key_idx" ON "chat_threads" USING btree ("workspace_id","demo_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_workspace_demo_key_idx" ON "sources" USING btree ("workspace_id","demo_key");