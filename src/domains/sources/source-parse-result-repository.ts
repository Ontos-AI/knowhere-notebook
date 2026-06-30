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

type SourceParseResultProgress = {
  readonly resultBlobUrl: string
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

type SourceParseResultRepository = {
  readonly saveParseResultEffect: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Effect.Effect<SourceParseResult | null, never, DbClient>
  readonly mergeParseAssetUrlsEffect: (
    workspaceId: string,
    sourceId: string,
    input: SaveSourceParseResultInput,
  ) => Effect.Effect<SourceParseResult | null, never, DbClient>
  readonly getParseResultProgressEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<SourceParseResultProgress | null, never, DbClient>
  readonly getParseAssetUrlsEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<Readonly<Record<string, string>>, never, DbClient>
}

export function buildAtomicAssetUrlsMergeSql(
  assetUrlsByFilePath: Readonly<Record<string, string>>,
) {
  return sql`${sourceParseResults.assetUrls} || ${JSON.stringify(assetUrlsByFilePath)}::jsonb`
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

const mergeParseAssetUrlsEffect: SourceParseResultRepository["mergeParseAssetUrlsEffect"] =
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
              assetUrls: buildAtomicAssetUrlsMergeSql(
                input.assetUrlsByFilePath,
              ),
              updatedAt: sql`now()`,
            },
          })
          .returning(),
      )

      return result ?? null
    })

const getParseResultProgressEffect: SourceParseResultRepository["getParseResultProgressEffect"] =
  (workspaceId: string, sourceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const source = yield* Effect.promise(() =>
        sourceRowRepository.findInWorkspaceWithDb(db, workspaceId, sourceId),
      )
      if (!source) return null

      const row = yield* Effect.promise(() =>
        db
          .select({
            resultBlobUrl: sourceParseResults.resultBlobUrl,
            assetUrls: sourceParseResults.assetUrls,
          })
          .from(sourceParseResults)
          .where(eq(sourceParseResults.sourceId, sourceId))
          .limit(1),
      )
      const progress = row[0]
      if (!progress) return null

      return {
        resultBlobUrl: progress.resultBlobUrl,
        assetUrlsByFilePath: progress.assetUrls,
      }
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
  mergeParseAssetUrlsEffect,
  getParseResultProgressEffect,
  getParseAssetUrlsEffect,
}
