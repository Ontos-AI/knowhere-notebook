import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  index,
  integer,
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
 *     uploads and parsed-source snapshots live in Blob storage; retrieval
 *     stays upstream in Knowhere.
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
 *   - `failure_stage`  — which stage failed: parse | storage_sync; drives
 *                        whether a retry reparses or only resumes storage sync
 *   - `knowhere_job_id`      — set once the parse job is created
 *   - `knowhere_document_id` — set when parsing completes; used to import
 *                              parsed snapshots and to exclude a source from a
 *                              retrieval query
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
    failureStage: text("failure_stage"),
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
 * reconciliation completes. The parsed snapshot itself (manifest, chunk pages,
 * assets, and resumable sync progress) lives in Vercel Blob under
 * `workspaces/{ws}/parsed-documents/{documentId}/{revisionKey}/...`, managed by
 * the SDK `ParsedDocumentStorage`. This row records:
 *   - `revision_key`  — current parsed revision (jobResultId ?? jobId); the
 *                       storage fast-path key passed into SDK reads
 *   - `sync_status`   — pending | running | completed | failed for the
 *                       background/parse-time storage sync
 *   - `sync_error`    — last storage-sync error detail when sync_status=failed
 *   - `result_blob_url` / `snapshot_manifest_*` — legacy columns retained for
 *                       rows written by the pre-migration manifest format
 *   - `asset_urls`    — legacy file-path-to-public-URL map for older rows
 */
export const sourceParseResults = pgTable(
  "source_parse_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" })
      .unique(),
    resultBlobUrl: text("result_blob_url"),
    snapshotManifestUrl: text("snapshot_manifest_url"),
    snapshotManifestKey: text("snapshot_manifest_key"),
    revisionKey: text("revision_key"),
    syncStatus: text("sync_status"),
    syncError: text("sync_error"),
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
 * Durable active-work leases for Notebook-owned parsed-document Blob sync.
 *
 * The sync workers acquire one row before calling the Knowhere SDK's
 * Vercel-Blob mirror. Active rows (`released_at IS NULL`) are counted globally,
 * per workspace, and per document so Vercel can scale route invocations without
 * allowing one user or one document to consume all sync capacity. Expired rows
 * are released during the next acquire attempt; normal workers release in a
 * `finally` block after their bounded sync segment exits.
 */
export const parsedDocumentSyncLeases = pgTable(
  "parsed_document_sync_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    revisionKey: text("revision_key"),
    leaseToken: text("lease_token").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("parsed_document_sync_leases_token_idx").on(t.leaseToken),
    index("parsed_document_sync_leases_active_idx")
      .on(t.expiresAt)
      .where(sql`released_at IS NULL`),
    index("parsed_document_sync_leases_workspace_active_idx")
      .on(t.workspaceId)
      .where(sql`released_at IS NULL`),
    index("parsed_document_sync_leases_document_active_idx")
      .on(t.documentId)
      .where(sql`released_at IS NULL`),
  ],
);

export type ParsedDocumentSyncLease =
  typeof parsedDocumentSyncLeases.$inferSelect;
export type NewParsedDocumentSyncLease =
  typeof parsedDocumentSyncLeases.$inferInsert;

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

/**
 * Fluid memory: typed insights extracted from human-AI conversation turns
 * (as opposed to "crystal memory", which is the parsed document knowledge
 * that stays upstream in Knowhere).
 *
 * One row per extracted insight. `kind` discriminates the typed `payload`
 * (see src/domains/memory/types.ts for the payload contract per kind):
 *   - indicator_pref      — a metric the user cares about (name, aliases,
 *                           polarity, importance)
 *   - stance              — a stated position that shapes judgement
 *   - decision_rule       — a when/then rule over indicators
 *   - entity_of_interest  — a company/topic the user tracks
 *
 * `abstract_l0` / `overview_l1` are the tiered sidecar summaries (L0 =
 * one line for pre-filter/dedup context, L1 = short paragraph for later
 * cognition injection). L2 is the payload itself.
 *
 * Lifecycle: rows start `active`; user revisions deprecate rather than
 * delete (conservative merge policy), with `version` bumped on merge.
 *
 * `source_message_id` points at the assistant message of the turn the
 * insight was extracted from; it is set-null on message deletion because
 * the insight outlives any single turn.
 */
export const fluidMemoryItems = pgTable(
  "fluid_memory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    abstractL0: text("abstract_l0").notNull(),
    overviewL1: text("overview_l1").notNull(),
    sourceMessageId: uuid("source_message_id").references(
      () => chatMessages.id,
      { onDelete: "set null" },
    ),
    confidence: doublePrecision("confidence").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Workspace lifecycle scans (active vs deprecated).
    index("fluid_memory_items_workspace_status_idx").on(
      t.workspaceId,
      t.status,
    ),
    index("fluid_memory_items_workspace_kind_idx").on(t.workspaceId, t.kind),
  ],
);

export type FluidMemoryItem = typeof fluidMemoryItems.$inferSelect;
export type NewFluidMemoryItem = typeof fluidMemoryItems.$inferInsert;

/**
 * Lexical inverted index over active fluid memory items, used to retrieve
 * dedup candidates at extraction time instead of loading the whole memory
 * set into the prompt. One row per (item, token); `frequency` counts token
 * occurrences in the item's search text.
 *
 * Invariant: token rows exist iff the owning item is `active`. Writers keep
 * this in sync — create inserts rows, merge replaces them, deprecate deletes
 * them — so lookups scan tokens alone (no status join) and never surface a
 * deprecated item.
 *
 * Tokenization mirrors Knowhere map-nav: single CJK characters plus
 * `[a-z0-9_]+` runs. Scoring is idf-weighted token overlap computed in SQL,
 * keeping the mechanism on portable Postgres (no pg_trgm/pgvector).
 */
export const fluidMemoryTokens = pgTable(
  "fluid_memory_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => fluidMemoryItems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    token: text("token").notNull(),
    frequency: integer("frequency").notNull().default(1),
  },
  (t) => [
    // Lookup: candidate tokens within a workspace + kind scope.
    index("fluid_memory_tokens_lookup_idx").on(
      t.workspaceId,
      t.kind,
      t.token,
    ),
    // Rebuild/delete a single item's rows on merge/deprecate.
    index("fluid_memory_tokens_item_idx").on(t.itemId),
  ],
);

export type FluidMemoryToken = typeof fluidMemoryTokens.$inferSelect;
export type NewFluidMemoryToken = typeof fluidMemoryTokens.$inferInsert;

/**
 * Append-only audit of extraction decisions, one row per processed turn.
 * `operations` is a JSONB array of { op, kind, itemId?, summary, reason? }
 * records (op = create | skip | merge | deprecate), mirroring OpenViking's
 * memory_diff.json so memory growth stays observable and reversible.
 */
export const memoryDiffs = pgTable(
  "memory_diffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id").references(
      () => chatMessages.id,
      { onDelete: "set null" },
    ),
    operations: jsonb("operations").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("memory_diffs_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export type MemoryDiff = typeof memoryDiffs.$inferSelect;
export type NewMemoryDiff = typeof memoryDiffs.$inferInsert;
