import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient, type Db } from "@/infrastructure/db"
import { sources, type Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"
import type { SourceStatus } from "./types"

type CreateUploadingSourceInput = {
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly stagedBlobPathname?: string | null
  readonly stagedBlobUrl?: string | null
  readonly originalBlobPathname?: string | null
  readonly originalBlobUrl?: string | null
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

type LocalizeRemoteDocumentInput = {
  readonly documentId: string
  readonly namespace?: string
  readonly title?: string
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly status: SourceStatus
  readonly revisionKey?: string | null
}

type SourceRowRepository = {
  readonly findInWorkspaceEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly listForWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<Source[], never, DbClient>
  readonly createUploadingEffect: (
    workspaceId: string,
    input: CreateUploadingSourceInput,
  ) => Effect.Effect<Source, never, DbClient>
  readonly localizeRemoteDocumentEffect: (
    workspaceId: string,
    input: LocalizeRemoteDocumentInput,
  ) => Effect.Effect<Source, never, DbClient>
  readonly markParsingEffect: (
    workspaceId: string,
    sourceId: string,
    jobId: string,
    documentId?: string,
    requiredStatus?: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markReadyEffect: (
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly updateRevisionKeyEffect: (
    workspaceId: string,
    sourceId: string,
    revisionKey: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markFailedEffect: (
    workspaceId: string,
    sourceId: string,
    reason: string,
    requiredStatus?: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly clearStagedBlobEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly softDeleteEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<boolean, never, DbClient>
  readonly isWorkspaceSourceId: (sourceId: string) => boolean
  readonly findInWorkspaceWithDb: (
    db: Db,
    workspaceId: string,
    sourceId: string,
  ) => Promise<Source | null>
  readonly updateInWorkspaceWithDb: (
    db: Db,
    workspaceId: string,
    sourceId: string,
    values: SourceUpdate,
    requiredStatus?: string,
  ) => Promise<Source | null>
  readonly localizeRemoteDocumentWithDb: (
    db: Db,
    workspaceId: string,
    input: LocalizeRemoteDocumentInput,
  ) => Promise<Source>
  readonly requireSource: (source: Source | null, message: string) => Source
}

const findInWorkspaceEffect: SourceRowRepository["findInWorkspaceEffect"] = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      findInWorkspaceWithDb(db, workspaceId, sourceId),
    )
  })

const listForWorkspaceEffect: SourceRowRepository["listForWorkspaceEffect"] = (
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

const createUploadingEffect: SourceRowRepository["createUploadingEffect"] = (
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

const localizeRemoteDocumentEffect: SourceRowRepository["localizeRemoteDocumentEffect"] =
  (workspaceId: string, input: LocalizeRemoteDocumentInput) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      return yield* Effect.promise(() =>
        localizeRemoteDocumentWithDb(db, workspaceId, input),
      )
    })

const markParsingEffect: SourceRowRepository["markParsingEffect"] = (
  workspaceId: string,
  sourceId: string,
  jobId: string,
  documentId?: string,
  requiredStatus?: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    status: "parsing",
    knowhereJobId: jobId,
    knowhereDocumentId: documentId,
    failureReason: null,
  }, requiredStatus)

const markReadyEffect: SourceRowRepository["markReadyEffect"] = (
  workspaceId: string,
  sourceId: string,
  documentId: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    status: "ready",
    knowhereDocumentId: documentId,
    failureReason: null,
  }, "parsing")

const updateRevisionKeyEffect: SourceRowRepository["updateRevisionKeyEffect"] = (
  workspaceId: string,
  sourceId: string,
  revisionKey: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    knowhereJobId: revisionKey,
  }, "ready")

const markFailedEffect: SourceRowRepository["markFailedEffect"] = (
  workspaceId: string,
  sourceId: string,
  reason: string,
  requiredStatus?: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    status: "failed",
    failureReason: reason,
  }, requiredStatus)

const clearStagedBlobEffect: SourceRowRepository["clearStagedBlobEffect"] = (
  workspaceId: string,
  sourceId: string,
) =>
  updateInWorkspaceEffect(workspaceId, sourceId, {
    stagedBlobPathname: null,
    stagedBlobUrl: null,
  })

const softDeleteEffect: SourceRowRepository["softDeleteEffect"] = (
  workspaceId: string,
  sourceId: string,
) =>
  Effect.gen(function* () {
    if (!isWorkspaceSourceId(sourceId)) return false

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

const updateInWorkspaceEffect = (
  workspaceId: string,
  sourceId: string,
  values: SourceUpdate,
  requiredStatus?: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      updateInWorkspaceWithDb(db, workspaceId, sourceId, values, requiredStatus),
    )
  })

async function findInWorkspaceWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
): Promise<Source | null> {
  if (!isWorkspaceSourceId(sourceId)) return null

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

async function updateInWorkspaceWithDb(
  db: Db,
  workspaceId: string,
  sourceId: string,
  values: SourceUpdate,
  requiredStatus?: string,
): Promise<Source | null> {
  if (!isWorkspaceSourceId(sourceId)) return null

  // Layer 3 — Atomic status guard.
  // When requiredStatus is set, the UPDATE only matches if the source is still in
  // the expected status. Two concurrent workflows will race; only one wins.
  const conditions = [
    eq(sources.id, sourceId),
    eq(sources.workspaceId, workspaceId),
    isNull(sources.deletedAt),
  ]
  if (requiredStatus) {
    conditions.push(eq(sources.status, requiredStatus))
  }

  const [source] = await db
    .update(sources)
    .set({ ...values, updatedAt: sql`now()` })
    .where(and(...conditions))
    .returning()

  if (!source && requiredStatus) {
    logger.warn(
      "source-repository: status transition skipped — atomic guard mismatch",
      {
        sourceId,
        workspaceId,
        requiredStatus,
        attemptedStatus: values.status,
      },
    )
  }

  return source ?? null
}

async function localizeRemoteDocumentWithDb(
  db: Db,
  workspaceId: string,
  input: LocalizeRemoteDocumentInput,
): Promise<Source> {
  const hasActiveLocalParsingJob = sql`${sources.status} = 'parsing' AND ${sources.knowhereJobId} IS NOT NULL`
  const values = {
    workspaceId,
    title: input.title ?? input.documentId,
    mimeType: input.mimeType ?? "application/octet-stream",
    sizeBytes: input.sizeBytes ?? 0,
    status: input.status,
    failureReason:
      input.status === "failed" ? "Knowhere document failed." : null,
    knowhereJobId: input.revisionKey ?? null,
    knowhereDocumentId: input.documentId,
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
  }

  const [source] = await db
    .insert(sources)
    .values(values)
    .onConflictDoUpdate({
      target: [sources.workspaceId, sources.knowhereDocumentId],
      targetWhere: sql`knowhere_document_id IS NOT NULL AND deleted_at IS NULL`,
      set: {
        title:
          input.title === undefined
            ? sql`${sources.title}`
            : values.title,
        mimeType:
          input.mimeType === undefined
            ? sql`${sources.mimeType}`
            : values.mimeType,
        sizeBytes:
          input.sizeBytes === undefined
            ? sql`${sources.sizeBytes}`
            : values.sizeBytes,
        status: sql`CASE WHEN ${hasActiveLocalParsingJob} THEN ${sources.status} ELSE ${values.status} END`,
        failureReason: sql`CASE WHEN ${hasActiveLocalParsingJob} THEN ${sources.failureReason} ELSE ${values.failureReason} END`,
        knowhereJobId: sql`CASE WHEN ${hasActiveLocalParsingJob} THEN ${sources.knowhereJobId} ELSE ${values.knowhereJobId} END`,
        updatedAt: sql`now()`,
      },
    })
    .returning()

  if (!source) {
    throw new Error("localizeRemoteDocument: upsert did not return a row.")
  }

  return source
}

const WORKSPACE_SOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function isWorkspaceSourceId(sourceId: string): boolean {
  return WORKSPACE_SOURCE_ID_PATTERN.test(sourceId)
}

function requireSource(source: Source | null, message: string): Source {
  if (!source) throw new Error(message)
  return source
}

export const sourceRowRepository: SourceRowRepository = {
  findInWorkspaceEffect,
  listForWorkspaceEffect,
  createUploadingEffect,
  localizeRemoteDocumentEffect,
  markParsingEffect,
  markReadyEffect,
  updateRevisionKeyEffect,
  markFailedEffect,
  clearStagedBlobEffect,
  softDeleteEffect,
  isWorkspaceSourceId,
  findInWorkspaceWithDb,
  updateInWorkspaceWithDb,
  localizeRemoteDocumentWithDb,
  requireSource,
}
