import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for Knowhere Notebook.
 *
 * Persistence rule (per @suguan + the technical plan):
 *   - Postgres stores only metadata, status, Knowhere IDs, and chat
 *     threads/messages.
 *   - It does NOT store file blobs or chunk copies. File blobs get
 *     streamed straight to Knowhere via a temp file and discarded.
 *     Chunks are fetched on demand from Knowhere's chunks API.
 *
 * Soft delete (per @Pi's PR-B review criteria):
 *   - Every user-visible resource has a nullable `deleted_at` timestamp.
 *   - Reads filter on `deleted_at IS NULL` by default (see helpers in
 *     src/lib/workspace.ts).
 *   - Hard delete is reserved for retention sweeps and admin paths.
 *
 * Portability rule (per @suguan):
 *   - Stay on portable Postgres. No Neon-only syntax, no pgvector, no
 *     extensions beyond `pgcrypto` (used implicitly by defaultRandom).
 *   - Migrating to AWS Aurora Postgres is a DATABASE_URL swap.
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

/**
 * One row per user-uploaded source. The row is the Notebook-owned record
 * of a Knowhere parse + index job; the actual chunks / file bytes live
 * upstream in Knowhere, not here.
 *
 * Fields:
 *   - `title`        — original file name as provided by the browser
 *   - `mime_type`    — the browser-reported content type (informational)
 *   - `size_bytes`   — original upload size (for display + quota)
 *   - `status`       — lifecycle: uploading | parsing | ready | failed
 *   - `failure_reason` — human-readable error text when status=failed
 *   - `knowhere_job_id`      — set once the parse job is created
 *   - `knowhere_document_id` — set when parsing completes; the sole handle
 *                              used to fetch chunks and to exclude a source
 *                              from a retrieval query
 *   - `deleted_at`   — soft delete timestamp; reads filter it out
 *
 * Indexes:
 *   - `(workspace_id, created_at DESC)` partial on `deleted_at IS NULL`
 *     for the sidebar list, which is by far the hot read path.
 *   - `(workspace_id, status)` for quick "still parsing" reconcile sweeps.
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    knowhereJobId: text("knowhere_job_id"),
    knowhereDocumentId: text("knowhere_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Sidebar list query: per workspace, newest first, soft-deleted
    // rows hidden. Partial index keeps the hot path lean.
    index("sources_workspace_created_idx")
      .on(t.workspaceId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    // Reconcile sweep picks up anything still in `uploading` or
    // `parsing`. Small cardinality, small index.
    index("sources_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/**
 * A chat thread is a conversation within a workspace. Title is optional
 * for the MVP — we don't auto-title yet.
 */
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Threads sidebar / history list: newest activity first, soft-deleted
    // hidden. We order by updated_at so a recently-active thread floats
    // to the top even if it was created long ago.
    index("chat_threads_workspace_updated_idx")
      .on(t.workspaceId, t.updatedAt.desc())
      .where(sql`deleted_at IS NULL`),
  ],
);

export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;

/**
 * One row per user or assistant turn in a thread.
 *
 * `citations` is JSONB of the retrieval-result view shape
 * (see `src/lib/types.ts#RetrievalResultView[]`). Stored only on
 * assistant rows. Citations are a derived snapshot of what was used
 * to ground the answer at response time — NOT a stored copy of the
 * source chunks, per the persistence rule.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Thread transcript: oldest first (natural reading order).
    index("chat_messages_thread_created_idx").on(t.threadId, t.createdAt),
  ],
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
