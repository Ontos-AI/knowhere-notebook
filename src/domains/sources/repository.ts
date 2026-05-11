import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient, type Db } from "@/infrastructure/db"
import {
  sourceParseResults,
  sources,
  type Source,
  type SourceParseResult,
} from "@/infrastructure/db/schema"
import type { DemoSourceUploadRepository } from "./upload"

type CreateUploadingSourceInput = {
  title: string
  mimeType: string
  sizeBytes: number
  stagedBlobPathname?: string | null
  stagedBlobUrl?: string | null
  originalBlobPathname?: string | null
  originalBlobUrl?: string | null
}

type CreateDemoUploadingSourceInput = {
  demoKey: string
  title: string
  mimeType: string
  sizeBytes: number
  originalBlobUrl: string
}

type MarkDemoSourceUploadingInput = {
  title: string
  mimeType: string
  sizeBytes: number
  originalBlobUrl: string
}

type SaveSourceParseResultInput = {
  resultBlobUrl: string
  assetUrlsByFilePath: Readonly<Record<string, string>>
}

type SourceUpdate = Partial<
  Pick<
    Source,
    | "title"
    | "mimeType"
    | "sizeBytes"
    | "status"
    | "failureReason"
    | "knowhereJobId"
    | "knowhereDocumentId"
    | "stagedBlobPathname"
    | "stagedBlobUrl"
    | "originalBlobPathname"
    | "originalBlobUrl"
  >
>

type SourceRepository = {
  readonly findInWorkspaceEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly findByDemoKeyEffect: (
    workspaceId: string,
    demoKey: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly listForWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<Source[], never, DbClient>
  readonly createUploadingEffect: (
    workspaceId: string,
    input: CreateUploadingSourceInput,
  ) => Effect.Effect<Source, never, DbClient>
  readonly createDemoUploadingEffect: (
    workspaceId: string,
    input: CreateDemoUploadingSourceInput,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markDemoUploadingEffect: (
    workspaceId: string,
    sourceId: string,
    input: MarkDemoSourceUploadingInput,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markParsingEffect: (
    workspaceId: string,
    sourceId: string,
    jobId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markReadyEffect: (
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markFailedEffect: (
    workspaceId: string,
    sourceId: string,
    reason: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly clearStagedBlobEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly softDeleteEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<boolean, never, DbClient>
  readonly saveParseResultEffect: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Effect.Effect<SourceParseResult | null, never, DbClient>
  readonly getParseAssetUrlsEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Readonly<Record<string, string>>, never, DbClient>
  readonly createDemoUploadRepository: (
    db: Db,
  ) => DemoSourceUploadRepository
}

const findInWorkspaceEffect: SourceRepository["findInWorkspaceEffect"] = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      findInWorkspaceWithDb(db, workspaceId, sourceId),
    )
  })

const findByDemoKeyEffect: SourceRepository["findByDemoKeyEffect"] = (
  workspaceId: string,
  demoKey: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      findByDemoKeyWithDb(db, workspaceId, demoKey),
    )
  })

const listForWorkspaceEffect: SourceRepository["listForWorkspaceEffect"] = (
  workspaceId: string,
) =>
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

const createUploadingEffect: SourceRepository["createUploadingEffect"] = (
  workspaceId: string,
  input: CreateUploadingSourceInput,
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

const createDemoUploadingEffect: SourceRepository["createDemoUploadingEffect"] =
  (workspaceId: string, input: CreateDemoUploadingSourceInput) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      return yield* Effect.promise(() =>
        createDemoUploadingWithDb(db, workspaceId, input),
      )
    })

const markDemoUploadingEffect: SourceRepository["markDemoUploadingEffect"] = (
  workspaceId: string,
  sourceId: string,
  input: MarkDemoSourceUploadingInput,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      markDemoUploadingWithDb(db, workspaceId, sourceId, input),
    )
  })

const markParsingEffect: SourceRepository["markParsingEffect"] = (
  workspaceId: string,
  sourceId: string,
  jobId: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    status: "parsing",
    knowhereJobId: jobId,
    failureReason: null,
  })

const markReadyEffect: SourceRepository["markReadyEffect"] = (
  workspaceId: string,
  sourceId: string,
  documentId: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    status: "ready",
    knowhereDocumentId: documentId,
    failureReason: null,
  })

const markFailedEffect: SourceRepository["markFailedEffect"] = (
  workspaceId: string,
  sourceId: string,
  reason: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    status: "failed",
    failureReason: reason,
  })

const clearStagedBlobEffect: SourceRepository["clearStagedBlobEffect"] = (
  workspaceId: string,
  sourceId: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    stagedBlobPathname: null,
    stagedBlobUrl: null,
  })

const softDeleteEffect: SourceRepository["softDeleteEffect"] = (
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

const saveParseResultEffect: SourceRepository["saveParseResultEffect"] = (
  workspaceId: string,
  sourceId: string,
  input: SaveSourceParseResultInput,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const source = yield* findInWorkspaceEffect(workspaceId, sourceId)
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

const getParseAssetUrlsEffect: SourceRepository["getParseAssetUrlsEffect"] = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const source = yield* findInWorkspaceEffect(workspaceId, sourceId)
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

function createDemoUploadRepository(db: Db): DemoSourceUploadRepository {
  return {
    findSourceByDemoKey: (workspaceId: string, demoKey: string) =>
      findByDemoKeyWithDb(db, workspaceId, demoKey),
    createDemoUploadingSource: (
      workspaceId: string,
      input: CreateDemoUploadingSourceInput,
    ) => createDemoUploadingWithDb(db, workspaceId, input),
    markDemoSourceUploading: async (
      workspaceId: string,
      sourceId: string,
      input: MarkDemoSourceUploadingInput,
    ) =>
      requireSource(
        await markDemoUploadingWithDb(db, workspaceId, sourceId, input),
        "Source disappeared before demo upload.",
      ),
    markSourceParsing: async (
      workspaceId: string,
      sourceId: string,
      jobId: string,
    ) =>
      requireSource(
        await updateInWorkspaceWithDb(db, workspaceId, sourceId, {
          status: "parsing",
          knowhereJobId: jobId,
          failureReason: null,
        }),
        "Source disappeared before parsing.",
      ),
    markSourceFailed: async (
      workspaceId: string,
      sourceId: string,
      reason: string,
    ) =>
      requireSource(
        await updateInWorkspaceWithDb(db, workspaceId, sourceId, {
          status: "failed",
          failureReason: reason,
        }),
        "Source disappeared before failure.",
      ),
  }
}

const updateInWorkspaceEffect = (
  workspaceId: string,
  sourceId: string,
  values: SourceUpdate,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      updateInWorkspaceWithDb(db, workspaceId, sourceId, values),
    )
  })

async function findInWorkspaceWithDb(
  db: Db,
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
    .limit(1)

  return row[0] ?? null
}

async function findByDemoKeyWithDb(
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

async function createDemoUploadingWithDb(
  db: Db,
  workspaceId: string,
  input: CreateDemoUploadingSourceInput,
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

async function markDemoUploadingWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
  input: MarkDemoSourceUploadingInput,
): Promise<Source | null> {
  return await updateInWorkspaceWithDb(db, workspaceId, sourceId, {
    title: input.title,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    status: "uploading",
    failureReason: null,
    knowhereJobId: null,
    knowhereDocumentId: null,
    originalBlobUrl: input.originalBlobUrl,
  })
}

async function updateInWorkspaceWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
  values: SourceUpdate,
): Promise<Source | null> {
  const [source] = await db
    .update(sources)
    .set({ ...values, updatedAt: sql`now()` })
    .where(
      and(
        eq(sources.id, sourceId),
        eq(sources.workspaceId, workspaceId),
        isNull(sources.deletedAt),
      ),
    )
    .returning()

  return source ?? null
}

function requireSource(source: Source | null, message: string): Source {
  if (!source) throw new Error(message)
  return source
}

export const sourceRepository: SourceRepository = {
  findInWorkspaceEffect,
  findByDemoKeyEffect,
  listForWorkspaceEffect,
  createUploadingEffect,
  createDemoUploadingEffect,
  markDemoUploadingEffect,
  markParsingEffect,
  markReadyEffect,
  markFailedEffect,
  clearStagedBlobEffect,
  softDeleteEffect,
  saveParseResultEffect,
  getParseAssetUrlsEffect,
  createDemoUploadRepository,
}
