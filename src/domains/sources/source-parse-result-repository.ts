import "server-only"

import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import {
  sourceParseResults,
  type SourceParseResult,
} from "@/infrastructure/db/schema"
import { sourceRowRepository } from "./source-row-repository"

type SaveSourceParseResultInput = {
  readonly resultBlobUrl: string
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

type SourceParseResultRepository = {
  readonly saveParseResultEffect: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Effect.Effect<SourceParseResult | null, never, DbClient>
  readonly getParseAssetUrlsEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Readonly<Record<string, string>>, never, DbClient>
}

const saveParseResultEffect: SourceParseResultRepository["saveParseResultEffect"] =
  (workspaceId: string, sourceId: string, input: SaveSourceParseResultInput) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const source = yield* Effect.promise(() =>
        sourceRowRepository.findInWorkspaceWithDb(db, workspaceId, sourceId),
      )
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

const getParseAssetUrlsEffect: SourceParseResultRepository["getParseAssetUrlsEffect"] =
  (workspaceId: string, sourceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const source = yield* Effect.promise(() =>
        sourceRowRepository.findInWorkspaceWithDb(db, workspaceId, sourceId),
      )
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

export const sourceParseResultRepository: SourceParseResultRepository = {
  saveParseResultEffect,
  getParseAssetUrlsEffect,
}
