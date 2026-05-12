import "server-only"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient, type Db } from "@/infrastructure/db"
import { sources, type Source } from "@/infrastructure/db/schema"
import type { DemoSourceUploadRepository } from "./source-upload-contracts"
import { sourceRowRepository } from "./source-row-repository"

type CreateDemoUploadingSourceInput = {
  readonly demoKey: string
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly originalBlobUrl: string
}

type MarkDemoSourceUploadingInput = {
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly originalBlobUrl: string
}

type DemoSourceRepository = {
  readonly findByDemoKeyEffect: (
    workspaceId: string,
    demoKey: string,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly createDemoUploadingEffect: (
    workspaceId: string,
    input: CreateDemoUploadingSourceInput,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly markDemoUploadingEffect: (
    workspaceId: string,
    sourceId: string,
    input: MarkDemoSourceUploadingInput,
  ) => Effect.Effect<Source | null, never, DbClient>
  readonly createDemoUploadRepository: (
    db: Db,
  ) => DemoSourceUploadRepository
}

const findByDemoKeyEffect: DemoSourceRepository["findByDemoKeyEffect"] = (
  workspaceId: string,
  demoKey: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      findByDemoKeyWithDb(db, workspaceId, demoKey),
    )
  })

const createDemoUploadingEffect: DemoSourceRepository["createDemoUploadingEffect"] =
  (workspaceId: string, input: CreateDemoUploadingSourceInput) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      return yield* Effect.promise(() =>
        createDemoUploadingWithDb(db, workspaceId, input),
      )
    })

const markDemoUploadingEffect: DemoSourceRepository["markDemoUploadingEffect"] =
  (
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
      sourceRowRepository.requireSource(
        await markDemoUploadingWithDb(db, workspaceId, sourceId, input),
        "Source disappeared before demo upload.",
      ),
    markSourceParsing: async (
      workspaceId: string,
      sourceId: string,
      jobId: string,
    ) =>
      sourceRowRepository.requireSource(
        await sourceRowRepository.updateInWorkspaceWithDb(
          db,
          workspaceId,
          sourceId,
          {
            status: "parsing",
            knowhereJobId: jobId,
            failureReason: null,
          },
        ),
        "Source disappeared before parsing.",
      ),
    markSourceFailed: async (
      workspaceId: string,
      sourceId: string,
      reason: string,
    ) =>
      sourceRowRepository.requireSource(
        await sourceRowRepository.updateInWorkspaceWithDb(
          db,
          workspaceId,
          sourceId,
          {
            status: "failed",
            failureReason: reason,
          },
        ),
        "Source disappeared before failure.",
      ),
  }
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
  return await sourceRowRepository.updateInWorkspaceWithDb(
    db,
    workspaceId,
    sourceId,
    {
      title: input.title,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "uploading",
      failureReason: null,
      knowhereJobId: null,
      knowhereDocumentId: null,
      originalBlobUrl: input.originalBlobUrl,
    },
  )
}

export const demoSourceRepository: DemoSourceRepository = {
  findByDemoKeyEffect,
  createDemoUploadingEffect,
  markDemoUploadingEffect,
  createDemoUploadRepository,
}
