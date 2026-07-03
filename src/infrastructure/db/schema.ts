import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle schema for Knowhere Notebook.
 *
 * Persistence rule:
 *   - Postgres stores only metadata, status, Knowhere IDs, and chat
 *     threads/messages.
 *   - It does NOT store file bytes or chunk copies in Postgres. Original
 *     uploads and parsed media artifacts live in Blob storage; chunks are
 *     fetched on demand from Knowhere's chunks API.
 *
 * Soft delete:
 *   - Every user-visible resource has a nullable `deleted_at` timestamp.
 *   - Reads filter on `deleted_at IS NULL` by default (see helpers in
 *     src/lib/workspace.ts).
 *   - Hard delete is reserved for retention sweeps and admin paths.
 *
 * Portability rule:
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
 *   - `original_blob_*` — public Blob pointer for the original upload preview
 *                         and download path
 *   - `staged_blob_*`   — legacy temporary Blob staging pointer retained for
 *                         older rows during the PR #28 transition
 *   - `demo_key`    — canonical demo source identifier when this row is a
 *                     materialized API-owned demo copy
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
    stagedBlobPathname: text("staged_blob_pathname"),
    stagedBlobUrl: text("staged_blob_url"),
    originalBlobPathname: text("original_blob_pathname"),
    originalBlobUrl: text("original_blob_url"),
    demoKey: text("demo_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("sources_workspace_created_idx")
      .on(t.workspaceId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("sources_workspace_status_idx").on(t.workspaceId, t.status),
    uniqueIndex("sources_workspace_demo_key_idx").on(t.workspaceId, t.demoKey),
    uniqueIndex("sources_workspace_document_idx")
      .on(t.workspaceId, t.knowhereDocumentId)
      .where(sql`knowhere_document_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/**
 * User presentation state for canonical demo sources before they are copied
 * into a real workspace source.
 */
export const demoSourceVisibilities = pgTable(
  "demo_source_visibilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    demoSourceId: text("demo_source_id").notNull(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("demo_source_visibilities_workspace_source_idx").on(
      t.workspaceId,
      t.demoSourceId,
    ),
    index("demo_source_visibilities_workspace_idx").on(t.workspaceId),
  ],
);

export type DemoSourceVisibility = typeof demoSourceVisibilities.$inferSelect;
export type NewDemoSourceVisibility = typeof demoSourceVisibilities.$inferInsert;

/**
 * Notebook-owned parse-result artifact index for one source.
 *
 * Blob is the Notebook-owned read model for parsed chunks after source
 * reconciliation completes. This row stores the current parsed snapshot
 * manifest and the file-path-to-public-URL map for parsed media artifacts.
 */
export const sourceParseResults = pgTable(
  "source_parse_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" })
      .unique(),
    resultBlobUrl: text("result_blob_url").notNull(),
    snapshotManifestUrl: text("snapshot_manifest_url"),
    snapshotManifestKey: text("snapshot_manifest_key"),
    assetUrls: jsonb("asset_urls")
      .$type<Readonly<Record<string, string>>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("source_parse_results_source_id_idx").on(t.sourceId)],
);

export type SourceParseResult = typeof sourceParseResults.$inferSelect;
export type NewSourceParseResult = typeof sourceParseResults.$inferInsert;

/**
 * A chat thread is a conversation within a workspace. `demo_key` is retained
 * for legacy seeded demo conversations.
 */
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title"),
    demoKey: text("demo_key"),
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
    uniqueIndex("chat_threads_workspace_demo_key_idx").on(
      t.workspaceId,
      t.demoKey,
    ),
  ],
);

export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;

/**
 * One row per user or assistant turn in a thread.
 *
 * `citations` is JSONB of citation metadata
 * (see `src/lib/types.ts#CitationView[]`). Stored only on assistant
 * rows. It intentionally excludes retrieval `content`, because that is
 * source chunk text and must stay upstream in Knowhere.
 *
 * `artifacts` is JSONB of the agent-selected display artifacts
 * (see `ChatArtifactView[]`): the exact images/tables the harness chose to
 * show, with their asset URLs and labels. Persisted so artifact selection
 * (e.g. "only two charts") survives reload instead of falling back to every
 * retrieved media citation. It carries no upstream chunk text.
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
    artifacts: jsonb("artifacts"),
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
