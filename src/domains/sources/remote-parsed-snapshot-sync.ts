import "server-only"

import { Effect } from "effect"

import type { Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"
import { createParsedResultStorageAdapter } from "./parse-result-storage-adapter"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type RemoteParsedSnapshotSource = Pick<
  Source,
  "id" | "workspaceId" | "knowhereDocumentId" | "knowhereJobId" | "status"
>

type RemoteParsedSnapshotClient = {
  readonly documents: {
    listChunks(
      documentId: string,
      params: {
        readonly page: number
        readonly pageSize: number
        readonly includeAssetUrls: boolean
      },
    ): Promise<{
      readonly jobId?: string | null
      readonly jobResultId?: string | null
    }>
  }
  readonly knowledge: {
    cacheJobResult(params: {
      readonly jobId: string
      readonly storageAdapter: ReturnType<typeof createParsedResultStorageAdapter>
    }): Promise<RemoteParsedSnapshotResponse>
  }
}

type RemoteParsedSnapshotResponse = {
  readonly assetUrlsByFilePath?: Readonly<Record<string, string>>
  readonly parsedSnapshot?: {
    readonly manifestKey: string
    readonly manifestUrl?: string
  }
}

type RemoteParsedSnapshotRepository = {
  readonly getParseSnapshotMetadata: typeof sourceWorkflowRuntime.getParseSnapshotMetadata
  readonly markParsing: typeof sourceWorkflowRuntime.markParsing
  readonly markReady: typeof sourceWorkflowRuntime.markReady
  readonly saveParseResult: typeof sourceWorkflowRuntime.saveParseResult
}

type SyncRemoteParsedSnapshotInput = {
  readonly workspaceId: string
  readonly source: RemoteParsedSnapshotSource
  readonly client: RemoteParsedSnapshotClient
  readonly repository?: RemoteParsedSnapshotRepository
}

type RemoteParsedSnapshotReadModel = {
  readonly resultBlobUrl: string
  readonly snapshotManifestUrl?: string | null
  readonly snapshotManifestKey?: string | null
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}

const jobProbePage = 1
const jobProbePageSize = 1

const syncRemoteParsedSnapshotEffect = Effect.fn(
  "syncRemoteParsedSnapshot",
)(function* ({
  workspaceId,
  source,
  client,
  repository = sourceWorkflowRuntime,
}: SyncRemoteParsedSnapshotInput) {
  const existingSnapshot = yield* Effect.tryPromise(() =>
    repository.getParseSnapshotMetadata(workspaceId, source.id),
  )
  if (isCompleteSnapshot(existingSnapshot)) {
    if (source.status === "parsing" && source.knowhereDocumentId) {
      yield* Effect.tryPromise(() =>
        repository.markReady(workspaceId, source.id, source.knowhereDocumentId!),
      )
    }
    return existingSnapshot
  }

  if (source.status !== "ready" && source.status !== "parsing") {
    return existingSnapshot
  }

  const documentId = source.knowhereDocumentId
  if (!documentId) {
    return yield* Effect.die(
      new Error("Remote source is missing a Knowhere document id."),
    )
  }

  const jobId = yield* resolveRemoteDocumentJobId({
    client,
    documentId,
    source,
  })
  yield* Effect.tryPromise(() =>
    repository.markParsing(workspaceId, source.id, jobId, documentId),
  )

  const snapshot = yield* Effect.tryPromise(async () => {
    const cachedResult = await client.knowledge.cacheJobResult({
      jobId,
      storageAdapter: createParsedResultStorageAdapter({
        workspaceId,
        sourceId: source.id,
      }),
    })
    const manifest = cachedResult.parsedSnapshot
    if (!manifest?.manifestUrl || !manifest.manifestKey) {
      throw new Error(
        "Remote parsed snapshot was not written; refusing to mark source ready.",
      )
    }
    return {
      assetUrlsByFilePath: cachedResult.assetUrlsByFilePath ?? {},
      snapshotManifestUrl: manifest.manifestUrl,
      snapshotManifestKey: manifest.manifestKey,
    }
  })

  const savedSnapshot = yield* Effect.tryPromise(() =>
    repository.saveParseResult(workspaceId, source.id, {
      resultBlobUrl: snapshot.snapshotManifestUrl,
      snapshotManifestUrl: snapshot.snapshotManifestUrl,
      snapshotManifestKey: snapshot.snapshotManifestKey,
      assetUrlsByFilePath: snapshot.assetUrlsByFilePath,
    }),
  )
  if (!savedSnapshot) {
    return yield* Effect.die(
      new Error("Remote parsed snapshot could not be saved for the source."),
    )
  }

  yield* Effect.tryPromise(() =>
    repository.markReady(workspaceId, source.id, documentId),
  )

  logger.info("sources: remote parsed snapshot synced", {
    sourceId: source.id,
    documentId,
    jobId,
    snapshotManifestKey: snapshot.snapshotManifestKey,
  })

  return {
    resultBlobUrl: snapshot.snapshotManifestUrl,
    snapshotManifestUrl: snapshot.snapshotManifestUrl,
    snapshotManifestKey: snapshot.snapshotManifestKey,
    assetUrlsByFilePath: snapshot.assetUrlsByFilePath,
  }
})

export async function syncRemoteParsedSnapshot(
  input: SyncRemoteParsedSnapshotInput,
): Promise<RemoteParsedSnapshotReadModel | null> {
  return Effect.runPromise(syncRemoteParsedSnapshotEffect(input))
}

const resolveRemoteDocumentJobId = Effect.fn("resolveRemoteDocumentJobId")(
  function* ({
    client,
    documentId,
    source,
  }: {
    readonly client: RemoteParsedSnapshotClient
    readonly documentId: string
    readonly source: RemoteParsedSnapshotSource
  }) {
    if (source.knowhereJobId) return source.knowhereJobId

    const response = yield* Effect.tryPromise(() =>
      client.documents.listChunks(documentId, {
        page: jobProbePage,
        pageSize: jobProbePageSize,
        includeAssetUrls: false,
      }),
    )
    const jobId = response.jobId ?? response.jobResultId
    if (!jobId) {
      return yield* Effect.die(
        new Error("Remote document chunk metadata did not include a job id."),
      )
    }
    return jobId
  },
)

function isCompleteSnapshot(
  snapshot: RemoteParsedSnapshotReadModel | null,
): snapshot is RemoteParsedSnapshotReadModel & {
  readonly snapshotManifestKey: string
  readonly snapshotManifestUrl: string
} {
  return (
    typeof snapshot?.snapshotManifestKey === "string" &&
    snapshot.snapshotManifestKey.length > 0 &&
    typeof snapshot.snapshotManifestUrl === "string" &&
    snapshot.snapshotManifestUrl.length > 0
  )
}
