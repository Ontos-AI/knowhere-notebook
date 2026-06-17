import "server-only"

import { and, eq, isNotNull, or, sql } from "drizzle-orm"
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
}

type DemoSourceRepository = {
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
  listHiddenDemoSourceIdsEffect,
  hideDemoSourceEffect,
  upsertMaterializedDemoSourceEffect,
}
