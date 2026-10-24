import "server-only"

import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import {
  demoSourceVisibilities,
  sources,
  type Source,
} from "@/infrastructure/db/schema"

type UpsertMaterializedDemoSourceInput = {
  readonly demoSourceId: string
  readonly title: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly knowhereDocumentId: string
  readonly originalBlobUrl: string | null
  readonly chunkCount?: number
}

type DemoSourceRepository = {
  readonly listLegacyDemoSourcesEffect: (workspaceId: string) => Effect.Effect<Source[], never, DbClient>
  readonly findLegacyDemoSourceEffect: (workspaceId: string, sourceId: string) => Effect.Effect<Source | null, never, DbClient>
  readonly listLegacyDemoDocumentIdsEffect: (workspaceId: string) => Effect.Effect<string[], never, DbClient>
  readonly listSelectedDemoSourceIdsEffect: (workspaceId: string) => Effect.Effect<string[], never, DbClient>
  readonly restoreDemoSourceEffect: (workspaceId: string, demoSourceId: string) => Effect.Effect<void, never, DbClient>
  readonly listHiddenDemoSourceIdsEffect: (
    workspaceId: string,
  ) => Effect.Effect<string[], never, DbClient>
  readonly hideDemoSourceEffect: (
    workspaceId: string,
    demoSourceId: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly upsertMaterializedDemoSourceEffect: (
    workspaceId: string,
    input: UpsertMaterializedDemoSourceInput,
  ) => Effect.Effect<Source, never, DbClient>
}

const listLegacyDemoSourcesEffect: DemoSourceRepository["listLegacyDemoSourcesEffect"] = Effect.fn("demoSources.listLegacySources")(function* (workspaceId: string) {
  const db = yield* DbClient
  return yield* Effect.promise(() => db.select().from(sources).where(and(eq(sources.workspaceId, workspaceId), isNotNull(sources.demoKey))))
})

const findLegacyDemoSourceEffect: DemoSourceRepository["findLegacyDemoSourceEffect"] = Effect.fn("demoSources.findLegacySource")(function* (workspaceId: string, sourceId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(sourceId)) return null
  const db = yield* DbClient
  const rows = yield* Effect.promise(() => db.select().from(sources).where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, sourceId), isNotNull(sources.demoKey))).limit(1))
  return rows[0] ?? null
})

const listLegacyDemoDocumentIdsEffect: DemoSourceRepository["listLegacyDemoDocumentIdsEffect"] = Effect.fn("demoSources.listLegacyDocumentIds")(function* (workspaceId: string) {
  const db = yield* DbClient
  const rows = yield* Effect.promise(() => db.select({ documentId: sources.knowhereDocumentId }).from(sources).where(and(eq(sources.workspaceId, workspaceId), isNotNull(sources.demoKey), isNotNull(sources.knowhereDocumentId))))
  return rows.flatMap((row) => row.documentId ? [row.documentId] : [])
})

const listSelectedDemoSourceIdsEffect: DemoSourceRepository["listSelectedDemoSourceIdsEffect"] = Effect.fn("demoSources.listSelected")(function* (workspaceId: string) {
  const db = yield* DbClient
  const rows = yield* Effect.promise(() => db.select({ demoSourceId: demoSourceVisibilities.demoSourceId }).from(demoSourceVisibilities).where(and(eq(demoSourceVisibilities.workspaceId, workspaceId), isNull(demoSourceVisibilities.hiddenAt), isNull(demoSourceVisibilities.deletedAt))))
  return rows.map((row) => row.demoSourceId)
})

const restoreDemoSourceEffect: DemoSourceRepository["restoreDemoSourceEffect"] = Effect.fn("demoSources.restore")(function* (workspaceId: string, demoSourceId: string) {
  const db = yield* DbClient
  yield* Effect.promise(() => db.insert(demoSourceVisibilities).values({ workspaceId, demoSourceId, hiddenAt: null, deletedAt: null }).onConflictDoUpdate({
    target: [demoSourceVisibilities.workspaceId, demoSourceVisibilities.demoSourceId],
    set: { hiddenAt: null, deletedAt: null, updatedAt: sql`now()` },
  }))
})

const listHiddenDemoSourceIdsEffect: DemoSourceRepository["listHiddenDemoSourceIdsEffect"] =
  (workspaceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select({ demoSourceId: demoSourceVisibilities.demoSourceId })
          .from(demoSourceVisibilities)
          .where(
            and(
              eq(demoSourceVisibilities.workspaceId, workspaceId),
              or(
                isNotNull(demoSourceVisibilities.hiddenAt),
                isNotNull(demoSourceVisibilities.deletedAt),
              ),
            ),
          ),
      )

      return rows.map((row) => row.demoSourceId)
    })

const hideDemoSourceEffect: DemoSourceRepository["hideDemoSourceEffect"] = (
  workspaceId: string,
  demoSourceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .insert(demoSourceVisibilities)
        .values({
          workspaceId,
          demoSourceId,
          hiddenAt: sql`now()`,
          deletedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [
            demoSourceVisibilities.workspaceId,
            demoSourceVisibilities.demoSourceId,
          ],
          set: {
            hiddenAt: sql`now()`,
            deletedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        }),
    )
  })

const upsertMaterializedDemoSourceEffect: DemoSourceRepository["upsertMaterializedDemoSourceEffect"] =
  (workspaceId: string, input: UpsertMaterializedDemoSourceInput) =>
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
            status: "ready",
            failureReason: null,
            knowhereJobId: null,
            knowhereDocumentId: input.knowhereDocumentId,
            originalBlobUrl: input.originalBlobUrl,
            demoKey: input.demoSourceId,
            ...(typeof input.chunkCount === "number"
              ? { chunkCount: input.chunkCount }
              : {}),
          })
          .onConflictDoUpdate({
            target: [sources.workspaceId, sources.demoKey],
            set: {
              title: input.title,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
              status: "ready",
              failureReason: null,
              knowhereJobId: null,
              knowhereDocumentId: input.knowhereDocumentId,
              originalBlobUrl: input.originalBlobUrl,
              ...(typeof input.chunkCount === "number"
                ? { chunkCount: input.chunkCount }
                : {}),
              deletedAt: null,
              updatedAt: sql`now()`,
            },
          })
          .returning(),
      )

      if (!source) {
        return yield* Effect.die(
          new Error("upsertMaterializedDemoSource: upsert did not return a row."),
        )
      }

      return source
    })

export const demoSourceRepository: DemoSourceRepository = {
  listLegacyDemoSourcesEffect,
  findLegacyDemoSourceEffect,
  listLegacyDemoDocumentIdsEffect,
  listSelectedDemoSourceIdsEffect,
  restoreDemoSourceEffect,
  listHiddenDemoSourceIdsEffect,
  hideDemoSourceEffect,
  upsertMaterializedDemoSourceEffect,
}
