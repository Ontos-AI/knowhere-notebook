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
  readonly revisionKey?: string
  readonly syncStatus?: SourceParseSyncStatus
  readonly syncError?: string | null
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

export type SourceParseSyncStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"

type SourceParseResultProgress = {
  readonly resultBlobUrl: string
  readonly snapshotManifestUrl?: string | null
  readonly snapshotManifestKey?: string | null
  readonly revisionKey?: string | null
  readonly syncStatus?: string | null
  readonly syncError?: string | null
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

export type SourceParseSnapshotMetadata = {
  readonly resultBlobUrl: string
  readonly snapshotManifestUrl?: string | null
  readonly snapshotManifestKey?: string | null
  readonly revisionKey?: string | null
  readonly syncStatus?: string | null
  readonly syncError?: string | null
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

type UpdateSyncStatusInput = {
  readonly revisionKey?: string
  readonly syncStatus: SourceParseSyncStatus
  readonly syncError?: string | null
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
  readonly updateSyncStatusEffect: (
    workspaceId: string,
    sourceId: string,
    input: UpdateSyncStatusInput,
  ) => Effect.Effect<SourceParseResult | null, never, DbClient>
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
            revisionKey: input.revisionKey,
            syncStatus: input.syncStatus,
            syncError: input.syncError,
            assetUrls: input.assetUrlsByFilePath,
          })
          .onConflictDoUpdate({
            target: sourceParseResults.sourceId,
            set: {
              resultBlobUrl: input.resultBlobUrl,
              snapshotManifestUrl: input.snapshotManifestUrl,
              snapshotManifestKey: input.snapshotManifestKey,
              revisionKey: input.revisionKey,
              syncStatus: input.syncStatus,
              syncError: input.syncError,
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
            revisionKey: input.revisionKey,
            syncStatus: input.syncStatus,
            syncError: input.syncError,
            assetUrls: input.assetUrlsByFilePath,
          })
          .onConflictDoUpdate({
            target: sourceParseResults.sourceId,
            set: {
              resultBlobUrl: input.resultBlobUrl,
              snapshotManifestUrl: input.snapshotManifestUrl,
              snapshotManifestKey: input.snapshotManifestKey,
              revisionKey: input.revisionKey,
              syncStatus: input.syncStatus,
              syncError: input.syncError,
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
            revisionKey: sourceParseResults.revisionKey,
            syncStatus: sourceParseResults.syncStatus,
            syncError: sourceParseResults.syncError,
            assetUrls: sourceParseResults.assetUrls,
          })
          .from(sourceParseResults)
          .where(eq(sourceParseResults.sourceId, sourceId))
          .limit(1),
      )
      const progress = row[0]
      if (!progress) return null

      return {
        resultBlobUrl: progress.resultBlobUrl ?? "",
        snapshotManifestUrl: progress.snapshotManifestUrl,
        snapshotManifestKey: progress.snapshotManifestKey,
        revisionKey: progress.revisionKey,
        syncStatus: progress.syncStatus,
        syncError: progress.syncError,
        assetUrlsByFilePath: progress.assetUrls,
      }
    })

const updateSyncStatusEffect: SourceParseResultRepository["updateSyncStatusEffect"] =
  (workspaceId: string, sourceId: string, input: UpdateSyncStatusInput) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const source = yield* Effect.promise(() =>
        sourceRowRepository.findInWorkspaceWithDb(db, workspaceId, sourceId),
      )
      if (!source) return null

      // Upsert: a read-miss backfill may set sync status before any parsed
      // snapshot row exists, so insert a bare row when one is not present yet.
      const [result] = yield* Effect.promise(() =>
        db
          .insert(sourceParseResults)
          .values({
            sourceId,
            revisionKey: input.revisionKey,
            syncStatus: input.syncStatus,
            syncError: input.syncError ?? null,
            assetUrls: {},
          })
          .onConflictDoUpdate({
            target: sourceParseResults.sourceId,
            set: {
              ...(input.revisionKey !== undefined
                ? { revisionKey: input.revisionKey }
                : {}),
              syncStatus: input.syncStatus,
              syncError: input.syncError ?? null,
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
  updateSyncStatusEffect,
}
