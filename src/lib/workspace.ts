import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"

import { chatRepository } from "./chat-repository"
import { DbClient, dbLayer, type Db } from "./db"
import {
  sourceParseResults,
  sources,
  workspaces,
  type Source,
  type Workspace,
} from "./schema"
import { demoData } from "./demo-data"
import {
  ensureDemoSourceUploadEffect,
  type UploadKnowhereClient,
} from "./source-upload"
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

export const ensureDemoWorkspaceContentEffect = (
  workspace: Workspace,
  knowhere: UploadKnowhereClient,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient

    for (const seed of demoData.listSourceSeeds()) {
      const source = yield* ensureDemoSourceUploadEffect(workspace, seed, {
        knowhere,
        repository: {
          findSourceByDemoKey: (workspaceId, demoKey) =>
            findDemoSourceInWorkspaceWithDb(db, workspaceId, demoKey),
          createDemoUploadingSource: (workspaceId, input) =>
            createDemoUploadingSourceWithDb(db, workspaceId, input),
          markDemoSourceUploading: (workspaceId, sourceId, input) =>
            markDemoSourceUploadingWithDb(db, workspaceId, sourceId, input),
          markSourceParsing: (workspaceId, sourceId, jobId) =>
            markSourceParsingWithDb(db, workspaceId, sourceId, jobId),
          markSourceFailed: (workspaceId, sourceId, reason) =>
            markSourceFailedWithDb(db, workspaceId, sourceId, reason),
        },
      })

      if (source?.status !== "ready" || !source.knowhereDocumentId) continue

      yield* chatRepository.ensureDemoThreadEffect(
        workspace.id,
        seed.demoKey,
        seed.chatThreadTitle,
        source.knowhereDocumentId,
      )
    }
  })

async function findDemoSourceInWorkspaceWithDb(
  db: Db,
  workspaceId: string,
  demoKey: string,
): Promise<Source | null> {
  const rows = await db
    .select()
    .from(sources)
    .where(
      and(eq(sources.workspaceId, workspaceId), eq(sources.demoKey, demoKey)),
    )
    .limit(1)

  return rows[0] ?? null
}

async function createDemoUploadingSourceWithDb(
  db: Db,
  workspaceId: string,
  input: {
    demoKey: string
    title: string
    mimeType: string
    sizeBytes: number
    originalBlobUrl: string
  },
): Promise<Source | null> {
  const [source] = await db
    .insert(sources)
    .values({
      workspaceId,
      title: input.title,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "uploading",
      originalBlobUrl: input.originalBlobUrl,
      demoKey: input.demoKey,
    })
    .onConflictDoNothing({
      target: [sources.workspaceId, sources.demoKey],
    })
    .returning()

  return source ?? null
}

async function markSourceParsingWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
  jobId: string,
): Promise<Source> {
  const [source] = await db
    .update(sources)
    .set({
      status: "parsing",
      knowhereJobId: jobId,
      failureReason: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.workspaceId, workspaceId),
        isNull(sources.deletedAt),
      ),
    )
    .returning()

  if (!source) throw new Error("Source disappeared before parsing.")
  return source
}

async function markDemoSourceUploadingWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
  input: {
    title: string
    mimeType: string
    sizeBytes: number
    originalBlobUrl: string
  },
): Promise<Source> {
  const [source] = await db
    .update(sources)
    .set({
      title: input.title,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "uploading",
      failureReason: null,
      knowhereJobId: null,
      knowhereDocumentId: null,
      originalBlobUrl: input.originalBlobUrl,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.workspaceId, workspaceId),
        isNull(sources.deletedAt),
      ),
    )
    .returning()

  if (!source) throw new Error("Source disappeared before demo upload.")
  return source
}

async function markSourceFailedWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
  reason: string,
): Promise<Source> {
  const [source] = await db
    .update(sources)
    .set({
      status: "failed",
      failureReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.workspaceId, workspaceId),
        isNull(sources.deletedAt),
      ),
    )
    .returning()

  if (!source) throw new Error("Source disappeared before failure.")
  return source
}

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
    stagedBlobPathname?: string | null
    stagedBlobUrl?: string | null
    originalBlobPathname?: string | null
    originalBlobUrl?: string | null
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
          stagedBlobPathname: input.stagedBlobPathname,
          stagedBlobUrl: input.stagedBlobUrl,
          originalBlobPathname: input.originalBlobPathname,
          originalBlobUrl: input.originalBlobUrl,
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

export const clearSourceStagedBlobEffect = (
  workspaceId: string,
  sourceId: string,
) =>
  updateSourceInWorkspaceEffect(workspaceId, sourceId, {
    stagedBlobPathname: null,
    stagedBlobUrl: null,
  })

export const saveSourceParseResultEffect = (
  workspaceId: string,
  sourceId: string,
  input: {
    resultBlobUrl: string
    assetUrlsByFilePath: Readonly<Record<string, string>>
  },
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const source = yield* findSourceInWorkspaceEffect(workspaceId, sourceId)
    if (!source) return null

    const [result] = yield* Effect.promise(() =>
      db
        .insert(sourceParseResults)
        .values({
          sourceId,
          resultBlobUrl: input.resultBlobUrl,
          assetUrls: input.assetUrlsByFilePath,
        })
        .onConflictDoUpdate({
          target: sourceParseResults.sourceId,
          set: {
            resultBlobUrl: input.resultBlobUrl,
            assetUrls: input.assetUrlsByFilePath,
            updatedAt: sql`now()`,
          },
        })
        .returning(),
    )

    return result ?? null
  })

export const getSourceParseAssetUrlsEffect = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const source = yield* findSourceInWorkspaceEffect(workspaceId, sourceId)
    if (!source) return {}

    const row = yield* Effect.promise(() =>
      db
        .select({ assetUrls: sourceParseResults.assetUrls })
        .from(sourceParseResults)
        .where(eq(sourceParseResults.sourceId, sourceId))
        .limit(1),
    )

    return row[0]?.assetUrls ?? {}
  })

export const findChatThreadInWorkspaceEffect =
  chatRepository.findThreadInWorkspaceEffect

export const listChatThreadsForWorkspaceEffect =
  chatRepository.listThreadsForWorkspaceEffect

export const createChatThreadEffect = chatRepository.createThreadEffect

export const ensureDefaultChatThreadEffect =
  chatRepository.ensureDefaultThreadEffect

export const listMessagesForThreadEffect =
  chatRepository.listMessagesForThreadEffect

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
      | "status"
      | "failureReason"
      | "knowhereJobId"
      | "knowhereDocumentId"
      | "stagedBlobPathname"
      | "stagedBlobUrl"
      | "originalBlobPathname"
      | "originalBlobUrl"
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

export const softDeleteChatThreadEffect = chatRepository.softDeleteThreadEffect

export const appendMessageToThreadEffect =
  chatRepository.appendMessageToThreadEffect

export const pingDatabaseEffect = Effect.gen(function* () {
  const db = yield* DbClient
  yield* Effect.promise(() => db.execute(sql`select 1`))
})

// ---- Async wrappers (Next.js boundary) ------------------------------------

export const ensureWorkspace = (userId: string) =>
  dbRuntime().runPromise(ensureWorkspaceEffect(userId))

export const ensureDemoWorkspaceContent = (
  workspace: Workspace,
  knowhere: UploadKnowhereClient,
) => dbRuntime().runPromise(ensureDemoWorkspaceContentEffect(workspace, knowhere))

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
    stagedBlobPathname?: string | null
    stagedBlobUrl?: string | null
    originalBlobPathname?: string | null
    originalBlobUrl?: string | null
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

export const clearSourceStagedBlob = (workspaceId: string, sourceId: string) =>
  dbRuntime().runPromise(clearSourceStagedBlobEffect(workspaceId, sourceId))

export const saveSourceParseResult = (
  workspaceId: string,
  sourceId: string,
  input: {
    resultBlobUrl: string
    assetUrlsByFilePath: Readonly<Record<string, string>>
  },
) =>
  dbRuntime().runPromise(
    saveSourceParseResultEffect(workspaceId, sourceId, input),
  )

export const getSourceParseAssetUrls = (
  workspaceId: string,
  sourceId: string,
) =>
  dbRuntime().runPromise(
    getSourceParseAssetUrlsEffect(workspaceId, sourceId),
  )

export const findChatThreadInWorkspace = (
  workspaceId: string,
  threadId: string,
) =>
  dbRuntime().runPromise(
    findChatThreadInWorkspaceEffect(workspaceId, threadId),
  )

export const listChatThreadsForWorkspace = (workspaceId: string) =>
  dbRuntime().runPromise(listChatThreadsForWorkspaceEffect(workspaceId))

export const createChatThread = (workspaceId: string) =>
  dbRuntime().runPromise(createChatThreadEffect(workspaceId))

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
