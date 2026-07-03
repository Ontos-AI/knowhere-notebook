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
  readonly snapshotManifestUrl?: string
  readonly snapshotManifestKey?: string
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

type SourceParseResultProgress = {
  readonly resultBlobUrl: string
  readonly snapshotManifestUrl?: string | null
  readonly snapshotManifestKey?: string | null
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

export type SourceParseSnapshotMetadata = {
  readonly resultBlobUrl: string
  readonly snapshotManifestUrl?: string | null
  readonly snapshotManifestKey?: string | null
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
  readonly getParseSnapshotMetadataEffect: (
    workspaceId: string,
    sourceId: string,
  ) => Effect.Effect<SourceParseSnapshotMetadata | null, never, DbClient>
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
            snapshotManifestUrl: input.snapshotManifestUrl,
            snapshotManifestKey: input.snapshotManifestKey,
            assetUrls: input.assetUrlsByFilePath,
          })
          .onConflictDoUpdate({
            target: sourceParseResults.sourceId,
            set: {
              resultBlobUrl: input.resultBlobUrl,
              snapshotManifestUrl: input.snapshotManifestUrl,
              snapshotManifestKey: input.snapshotManifestKey,
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
            snapshotManifestUrl: input.snapshotManifestUrl,
            snapshotManifestKey: input.snapshotManifestKey,
            assetUrls: input.assetUrlsByFilePath,
          })
          .onConflictDoUpdate({
            target: sourceParseResults.sourceId,
            set: {
              resultBlobUrl: input.resultBlobUrl,
              snapshotManifestUrl: input.snapshotManifestUrl,
              snapshotManifestKey: input.snapshotManifestKey,
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
            snapshotManifestUrl: sourceParseResults.snapshotManifestUrl,
            snapshotManifestKey: sourceParseResults.snapshotManifestKey,
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
        snapshotManifestUrl: progress.snapshotManifestUrl,
        snapshotManifestKey: progress.snapshotManifestKey,
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

const getParseSnapshotMetadataEffect: SourceParseResultRepository["getParseSnapshotMetadataEffect"] =
  (workspaceId: string, sourceId: string) =>
    Effect.gen(function* () {
      const progress = yield* getParseResultProgressEffect(workspaceId, sourceId)
      return progress
    })

export const sourceParseResultRepository: SourceParseResultRepository = {
  saveParseResultEffect,
  mergeParseAssetUrlsEffect,
  getParseResultProgressEffect,
  getParseSnapshotMetadataEffect,
  getParseAssetUrlsEffect,
}
