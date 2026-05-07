import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import {
  chatMessages,
  chatThreads,
  sources,
  workspaces,
  type ChatMessage,
  type ChatThread,
  type Source,
  type Workspace,
} from "./schema";
import type { CitationView, RetrievalResultView } from "./types";

/**
 * Ensure a workspace exists for the given Dashboard user id.
 *
 * MVP model: one workspace per user. This runs on every authenticated
 * request that needs workspace context. It is idempotent:
 *   - First call inserts the row with a deterministic `namespace`
 *     derived from the generated UUID.
 *   - Every subsequent call is a single `SELECT ... WHERE user_id = $1`
 *     returning the existing row.
 *
 * The insert uses `ON CONFLICT (user_id) DO NOTHING` so concurrent first
 * calls from the same user race safely to the same row.
 */
export async function ensureWorkspace(userId: string): Promise<Workspace> {
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .limit(1);

  if (existing[0]) return existing[0];

  // Namespace is derived from a fresh UUID so it's guaranteed unique and
  // opaque to the browser. We insert + select-back so we see the actual
  // row regardless of who wins a race.
  const namespace = `notebook-${crypto.randomUUID()}`;
  await db
    .insert(workspaces)
    .values({ userId, namespace })
    .onConflictDoNothing({ target: workspaces.userId });

  const row = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .limit(1);

  if (!row[0]) {
    // This should be impossible — the ON CONFLICT path guarantees a row
    // exists after the insert completes. Surface loudly if it ever does.
    throw new Error(
      `ensureWorkspace: workspace row not found for user ${userId} after ` +
        "upsert. Check that the workspaces.user_id unique index exists.",
    );
  }

  return row[0];
}

/**
 * Fetch a source by id, scoped to the given workspace, excluding
 * soft-deleted rows.
 *
 * Returns `null` if the source doesn't exist, belongs to a different
 * workspace, or has been soft-deleted. Callers that mutate a source
 * (update status, soft-delete, etc.) must call this first — never
 * query by raw `id` alone, because the id comes from the browser and
 * is otherwise free to forge.
 */
export async function findSourceInWorkspace(
  workspaceId: string,
  sourceId: string,
): Promise<Source | null> {
  const row = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.workspaceId, workspaceId),
        isNull(sources.deletedAt),
      ),
    )
    .limit(1);
  return row[0] ?? null;
}

/**
 * Fetch a chat thread by id, scoped to the given workspace, excluding
 * soft-deleted rows. Same contract as `findSourceInWorkspace`.
 */
export async function findChatThreadInWorkspace(
  workspaceId: string,
  threadId: string,
): Promise<ChatThread | null> {
  const row = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.workspaceId, workspaceId),
        isNull(chatThreads.deletedAt),
      ),
    )
    .limit(1);
  return row[0] ?? null;
}

/**
 * Soft-delete a source if (and only if) it belongs to the workspace and
 * is not already deleted. Returns `true` when a row was updated.
 *
 * Used instead of a hard DELETE per @Pi's N-006 review criteria. The
 * sidebar list and all read helpers filter on `deleted_at IS NULL`, so
 * a soft-deleted source disappears from the UI but stays available for
 * retention sweeps and audit.
 */
export async function softDeleteSource(
  workspaceId: string,
  sourceId: string,
): Promise<boolean> {
  const result = await db
    .update(sources)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.workspaceId, workspaceId),
        isNull(sources.deletedAt),
      ),
    )
    .returning({ id: sources.id });
  return result.length > 0;
}

/**
 * Soft-delete a chat thread. Cascading delete of messages is NOT applied
 * — messages stay intact so the thread can be restored later. The
 * transcript read path filters by `deleted_at IS NULL` on the thread
 * itself, so soft-deleted threads don't show up in the history list.
 */
export async function softDeleteChatThread(
  workspaceId: string,
  threadId: string,
): Promise<boolean> {
  const result = await db
    .update(chatThreads)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(chatThreads.id, threadId),
        eq(chatThreads.workspaceId, workspaceId),
        isNull(chatThreads.deletedAt),
      ),
    )
    .returning({ id: chatThreads.id });
  return result.length > 0;
}

/**
 * Append a user or assistant message to a thread, verifying the thread
 * belongs to the given workspace first. Bumps the thread's `updated_at`
 * so it floats to the top of the history list.
 *
 * Returns the inserted row, or `null` if the thread doesn't belong to
 * the workspace. Callers are responsible for mapping `null` to a 404 /
 * similar — we deliberately don't throw here so the same function can
 * be used from both server actions and the retrieval route.
 */
export async function appendMessageToThread(
  workspaceId: string,
  input: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    citations?: readonly (CitationView | RetrievalResultView)[] | null;
  },
): Promise<ChatMessage | null> {
  const thread = await findChatThreadInWorkspace(workspaceId, input.threadId);
  if (!thread) return null;

  const [inserted] = await db
    .insert(chatMessages)
    .values({
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      citations: normalizeCitations(input.citations),
    })
    .returning();
  // Use the DB's own clock instead of JS time so `updated_at` always
  // advances monotonically relative to `now()`. JS's `new Date()` can
  // land a few microseconds behind Postgres's `now()` due to clock skew.
  await db
    .update(chatThreads)
    .set({ updatedAt: sql`now()` })
    .where(eq(chatThreads.id, input.threadId));
  return inserted ?? null;
}

function normalizeCitations(
  citations: readonly (CitationView | RetrievalResultView)[] | null | undefined,
): CitationView[] | null {
  if (!citations || citations.length === 0) return null;
  return citations.map(toCitationView);
}

function toCitationView(citation: CitationView | RetrievalResultView): CitationView {
  return {
    chunkType: citation.chunkType,
    score: citation.score,
    assetUrl: citation.assetUrl,
    source: {
      documentId: citation.source.documentId,
      sourceFileName: citation.source.sourceFileName,
      sectionPath: citation.source.sectionPath,
    },
  };
}

/**
 * Smoke test for the Postgres connection. Used by any health-check
 * endpoint so we can verify the deploy without needing a real user
 * session.
 */
export async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}
