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
 * Workspaces: the persistence unit for a namespace-scoped document set.
 *
 * A workspace binds one user to one Knowhere namespace. The credential used
 * to access that namespace is the mutable `active_knowhere_api_key_id`
 * pointer (key-agnostic: the user can re-point it to any of their API keys
 * at any time). One workspace per (user, namespace) tuple.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    namespace: text("namespace").notNull(),
    activeKnowhereApiKeyId: uuid("active_knowhere_api_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("workspaces_user_id_idx").on(t.userId),
    uniqueIndex("workspaces_user_namespace_idx").on(t.userId, t.namespace),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

/**
 * Workspace membership for team sharing (Phase 4).
 *
 * `workspaces.user_id` remains the owner (implicit owner role). Members are
 * invited by email; each membership row grants access to the workspace's
 * sources/chats under the member's own user id.
 */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("workspace_members_workspace_id_idx").on(t.workspaceId),
    index("workspace_members_user_id_idx").on(t.userId),
    uniqueIndex("workspace_members_workspace_user_idx")
      .on(t.workspaceId, t.userId),
  ],
);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

/**
 * Encrypted Knowhere API keys, owned by a user (not a workspace) — the
 * credential for any of the user's workspaces.
 *
 * The raw key never touches the browser or the logs: the server encrypts it
 * with AES-256-GCM (key from `KNOWHERE_KEY_ENCRYPTION_KEY`) before storing
 * `cipher_blob` + `cipher_nonce`, and decrypts on demand only when a
 * Knowhere request needs the credential. `key_mask` is computed once at
 * save time so listing keys never needs to decrypt.
 */
export const knowhereApiKeys = pgTable(
  "knowhere_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    keyMask: text("key_mask").notNull(),
    cipherBlob: text("cipher_blob").notNull(),
    cipherNonce: text("cipher_nonce").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("knowhere_api_keys_user_id_idx").on(t.userId),
    uniqueIndex("knowhere_api_keys_user_label_idx")
      .on(t.userId, t.label)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type KnowhereApiKey = typeof knowhereApiKeys.$inferSelect;
export type NewKnowhereApiKey = typeof knowhereApiKeys.$inferInsert;

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
    uniqueIndex("sources_workspace_document_idx")
      .on(t.workspaceId, t.knowhereDocumentId)
      .where(sql`knowhere_document_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/**
 * Notebook-owned parse-result artifact index for one source.
 *
 * Knowhere's chunk list currently may omit media asset URLs, while parsed chunk
 * metadata still points to ZIP-relative files like `images/image-1.jpg`.
 * This table stores the Notebook Blob copy of the result ZIP plus a
 * file-path-to-public-URL map for those extracted parsed artifacts.
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
 * A chat thread is a conversation within a workspace.
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
 * Notebook-owned users. Created by the admin CLI (scripts/create-user.ts)
 * in Phase 2; OAuth/SSO links attach via `account_links`.
 *
 * `email` is unique and serves as the login handle. `email_verified_at`
 * is set once email verification exists (deferred; null for now).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Credential links for modular auth providers.
 *
 * One row per (user, provider) pair — a user can sign in with password
 * AND Google/GitHub later. `password_hash` lives here (only for the
 * "password" provider), keeping OAuth-only users hash-free.
 */
export const accountLinks = pgTable(
  "account_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("account_links_user_provider_idx").on(t.userId, t.provider),
    uniqueIndex("account_links_provider_provider_user_idx").on(
      t.provider,
      t.providerUserId,
    ),
  ],
);

export type AccountLink = typeof accountLinks.$inferSelect;
export type NewAccountLink = typeof accountLinks.$inferInsert;

/**
 * DB-backed sessions: one row per active login, revocable server-side.
 *
 * The `notebook-session` cookie holds the session id; `getCurrentUser`
 * joins this table to `users` on every request. Expired rows are ignored
 * (and swept opportunistically).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
