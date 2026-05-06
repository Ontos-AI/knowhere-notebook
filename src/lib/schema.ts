import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for Knowhere Notebook.
 *
 * Scope for PR-A (N-001): only `workspaces`. The rest of the tables
 * (sources, chat_threads, chat_messages) land in PR-B per the plan.
 *
 * Portability rule (per @suguan): stay on portable Postgres so we can
 * swap to AWS Aurora if Neon free tier becomes limiting. Avoid Neon-only
 * syntax, don't depend on extensions beyond pgcrypto.
 */

/**
 * One workspace per user for the MVP. `user_id` is the Dashboard user id
 * as returned by `users.getCurrentUser` (not a Notebook-local id).
 *
 * `namespace` is the Knowhere namespace this workspace's sources all live
 * in. It is derived once from the workspace id and never mutated.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().unique(),
    namespace: text("namespace").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workspaces_user_id_idx").on(t.userId)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
