import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"

import { DbClient, dbLayer } from "./db"
import {
  chatMessages,
  chatThreads,
  sources,
  workspaces,
  type ChatMessage,
  type ChatThread,
  type Source,
  type Workspace,
} from "./schema"
import type { CitationView, RetrievalResultView } from "./types"

let _dbRuntime: ManagedRuntime.ManagedRuntime<DbClient, never> | null = null
function dbRuntime(): ManagedRuntime.ManagedRuntime<DbClient, never> {
  if (!_dbRuntime) _dbRuntime = ManagedRuntime.make(dbLayer)
  return _dbRuntime
}

// ---- Effect functions (canonical) -----------------------------------------

export const ensureWorkspaceEffect = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const existing = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1),
    )

    if (existing[0]) return existing[0]

    const namespace = `notebook-${crypto.randomUUID()}`
    yield* Effect.promise(() =>
      db
        .insert(workspaces)
        .values({ userId, namespace })
        .onConflictDoNothing({ target: workspaces.userId }),
    )

    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1),
    )

    if (!row[0]) {
      return yield* Effect.die(
        new Error(
          `ensureWorkspace: workspace row not found for user ${userId} after ` +
            "upsert. Check that the workspaces.user_id unique index exists.",
        ),
      )
    }

    return row[0]
  })

export const findSourceInWorkspaceEffect = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.id, sourceId),
            eq(sources.workspaceId, workspaceId),
            isNull(sources.deletedAt),
          ),
        )
        .limit(1),
    )
    return row[0] ?? null
  })

export const listSourcesForWorkspaceEffect = (workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db
        .select()
        .from(sources)
        .where(
          and(eq(sources.workspaceId, workspaceId), isNull(sources.deletedAt)),
        )
        .orderBy(desc(sources.createdAt)),
    )
  })

export const createUploadingSourceEffect = (
  workspaceId: string,
  input: {
    title: string
    mimeType: string
    sizeBytes: number
  },
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const [source] = yield* Effect.promise(() =>
      db
        .insert(sources)
        .values({
          workspaceId,
          title: input.title,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          status: "uploading",
        })
        .returning(),
    )

    if (!source) {
      return yield* Effect.die(
        new Error("createUploadingSource: insert did not return a row."),
      )
    }

    return source
  })

export const markSourceParsingEffect = (
  workspaceId: string,
  sourceId: string,
  jobId: string,
) =>
  updateSourceInWorkspaceEffect(workspaceId, sourceId, {
    status: "parsing",
    knowhereJobId: jobId,
    failureReason: null,
  })

export const markSourceReadyEffect = (
  workspaceId: string,
  sourceId: string,
  documentId: string,
) =>
  updateSourceInWorkspaceEffect(workspaceId, sourceId, {
    status: "ready",
    knowhereDocumentId: documentId,
    failureReason: null,
  })

export const markSourceFailedEffect = (
  workspaceId: string,
  sourceId: string,
  reason: string,
) =>
  updateSourceInWorkspaceEffect(workspaceId, sourceId, {
    status: "failed",
    failureReason: reason,
  })

export const findChatThreadInWorkspaceEffect = (
  workspaceId: string,
  threadId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.id, threadId),
            eq(chatThreads.workspaceId, workspaceId),
            isNull(chatThreads.deletedAt),
          ),
        )
        .limit(1),
    )
    return row[0] ?? null
  })

export const ensureDefaultChatThreadEffect = (workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const existing = yield* Effect.promise(() =>
      db
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.workspaceId, workspaceId),
            isNull(chatThreads.deletedAt),
          ),
        )
        .orderBy(desc(chatThreads.updatedAt))
        .limit(1),
    )
    if (existing[0]) return existing[0]

    const [thread] = yield* Effect.promise(() =>
      db.insert(chatThreads).values({ workspaceId }).returning(),
    )
    if (!thread) {
      return yield* Effect.die(
        new Error("ensureDefaultChatThread: insert did not return a row."),
      )
    }
    return thread
  })

export const listMessagesForThreadEffect = (
  workspaceId: string,
  threadId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const thread = yield* findChatThreadInWorkspaceEffect(workspaceId, threadId)
    if (!thread) return null

    return yield* Effect.promise(() =>
      db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.threadId, threadId))
        .orderBy(chatMessages.createdAt),
    )
  })

export const softDeleteSourceEffect = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const result = yield* Effect.promise(() =>
      db
        .update(sources)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(sources.id, sourceId),
            eq(sources.workspaceId, workspaceId),
            isNull(sources.deletedAt),
          ),
        )
        .returning({ id: sources.id }),
    )
    return result.length > 0
  })

const updateSourceInWorkspaceEffect = (
  workspaceId: string,
  sourceId: string,
  values: Partial<
    Pick<
      Source,
      "status" | "failureReason" | "knowhereJobId" | "knowhereDocumentId"
    >
  >,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const [source] = yield* Effect.promise(() =>
      db
        .update(sources)
        .set({ ...values, updatedAt: sql`now()` })
        .where(
          and(
            eq(sources.id, sourceId),
            eq(sources.workspaceId, workspaceId),
            isNull(sources.deletedAt),
          ),
        )
        .returning(),
    )
    return source ?? null
  })

export const softDeleteChatThreadEffect = (
  workspaceId: string,
  threadId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const result = yield* Effect.promise(() =>
      db
        .update(chatThreads)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(chatThreads.id, threadId),
            eq(chatThreads.workspaceId, workspaceId),
            isNull(chatThreads.deletedAt),
          ),
        )
        .returning({ id: chatThreads.id }),
    )
    return result.length > 0
  })

export const appendMessageToThreadEffect = (
  workspaceId: string,
  input: {
    threadId: string
    role: "user" | "assistant"
    content: string
    citations?: readonly (CitationView | RetrievalResultView)[] | null
  },
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const thread = yield* findChatThreadInWorkspaceEffect(
      workspaceId,
      input.threadId,
    )
    if (!thread) return null

    return yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(chatMessages)
          .values({
            threadId: input.threadId,
            role: input.role,
            content: input.content,
            citations: normalizeCitations(input.citations),
          })
          .returning()
        await tx
          .update(chatThreads)
          .set({ updatedAt: sql`now()` })
          .where(eq(chatThreads.id, input.threadId))
        return inserted ?? null
      }),
    )
  })

export const pingDatabaseEffect = Effect.gen(function* () {
  const db = yield* DbClient
  yield* Effect.promise(() => db.execute(sql`select 1`))
})

// ---- Async wrappers (Next.js boundary) ------------------------------------

export const ensureWorkspace = (userId: string) =>
  dbRuntime().runPromise(ensureWorkspaceEffect(userId))

export const findSourceInWorkspace = (workspaceId: string, sourceId: string) =>
  dbRuntime().runPromise(findSourceInWorkspaceEffect(workspaceId, sourceId))

export const listSourcesForWorkspace = (workspaceId: string) =>
  dbRuntime().runPromise(listSourcesForWorkspaceEffect(workspaceId))

export const createUploadingSource = (
  workspaceId: string,
  input: {
    title: string
    mimeType: string
    sizeBytes: number
  },
) =>
  dbRuntime().runPromise(createUploadingSourceEffect(workspaceId, input))

export const markSourceParsing = (
  workspaceId: string,
  sourceId: string,
  jobId: string,
) => dbRuntime().runPromise(markSourceParsingEffect(workspaceId, sourceId, jobId))

export const markSourceReady = (
  workspaceId: string,
  sourceId: string,
  documentId: string,
) =>
  dbRuntime().runPromise(markSourceReadyEffect(workspaceId, sourceId, documentId))

export const markSourceFailed = (
  workspaceId: string,
  sourceId: string,
  reason: string,
) =>
  dbRuntime().runPromise(markSourceFailedEffect(workspaceId, sourceId, reason))

export const findChatThreadInWorkspace = (
  workspaceId: string,
  threadId: string,
) =>
  dbRuntime().runPromise(
    findChatThreadInWorkspaceEffect(workspaceId, threadId),
  )

export const ensureDefaultChatThread = (workspaceId: string) =>
  dbRuntime().runPromise(ensureDefaultChatThreadEffect(workspaceId))

export const listMessagesForThread = (
  workspaceId: string,
  threadId: string,
) =>
  dbRuntime().runPromise(listMessagesForThreadEffect(workspaceId, threadId))

export const softDeleteSource = (workspaceId: string, sourceId: string) =>
  dbRuntime().runPromise(softDeleteSourceEffect(workspaceId, sourceId))

export const softDeleteChatThread = (workspaceId: string, threadId: string) =>
  dbRuntime().runPromise(softDeleteChatThreadEffect(workspaceId, threadId))

export const appendMessageToThread = (
  workspaceId: string,
  input: {
    threadId: string
    role: "user" | "assistant"
    content: string
    citations?: readonly (CitationView | RetrievalResultView)[] | null
  },
) => dbRuntime().runPromise(appendMessageToThreadEffect(workspaceId, input))

export const pingDatabase = () => dbRuntime().runPromise(pingDatabaseEffect)

// ---- Helpers ---------------------------------------------------------------

function normalizeCitations(
  citations:
    | readonly (CitationView | RetrievalResultView)[]
    | null
    | undefined,
): CitationView[] | null {
  if (!citations || citations.length === 0) return null
  return citations.map(toCitationView)
}

function toCitationView(
  citation: CitationView | RetrievalResultView,
): CitationView {
  return {
    chunkType: citation.chunkType,
    score: citation.score,
    assetUrl: citation.assetUrl,
    source: {
      documentId: citation.source.documentId,
      sourceFileName: citation.source.sourceFileName,
      sectionPath: citation.source.sectionPath,
    },
  }
}
