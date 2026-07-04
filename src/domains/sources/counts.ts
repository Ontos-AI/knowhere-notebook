import "server-only"

import { Effect } from "effect"
import type Knowhere from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import {
  readParsedResultSnapshotManifest,
  type ParsedResultSnapshotManifest,
} from "./parse-result-storage-adapter"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type ChunkCountRepository = Pick<
  typeof sourceWorkflowRuntime,
  "getParseSnapshotMetadata"
>

type ChunkCountOptions = {
  readonly readSnapshotManifest?: typeof readParsedResultSnapshotManifest
  readonly repository?: ChunkCountRepository
}

export const countChunksBySourceId = (
  sources: readonly Source[],
  client: Knowhere,
  options: ChunkCountOptions = {},
) =>
  Effect.gen(function* () {
    void client
    const readySources = sources.filter(
      (source) =>
        !source.demoKey &&
        source.status === "ready" &&
        source.knowhereDocumentId,
    )
    if (readySources.length === 0) return new Map<string, number>()

    const entries = yield* Effect.all(
      readySources.map((source) =>
        Effect.gen(function* () {
          const manifest = yield* Effect.tryPromise(() =>
            loadSourceSnapshotManifest(source, options),
          ).pipe(
            Effect.catchAll(() =>
              Effect.succeed<ParsedResultSnapshotManifest | null>(null),
            ),
          )
          if (!manifest) return [source.id, undefined] as const

          return [
            source.id,
            manifest.totalChunks,
          ] as const
        }),
      ),
      { concurrency: "unbounded" },
    )

    return new Map(
      entries.filter(
        (entry): entry is readonly [string, number] =>
          typeof entry[1] === "number",
      ),
    )
  })

export const sourceViewOptionsBySourceId = (
  sources: readonly Source[],
  client: Knowhere,
  options: ChunkCountOptions = {},
) =>
  Effect.gen(function* () {
    const counts = yield* countChunksBySourceId(sources, client, options)
    return new Map(
      sources.map((source) => [
        source.id,
        { chunkCount: counts.get(source.id) },
      ]),
    )
  })

async function loadSourceSnapshotManifest(
  source: Source,
  options: ChunkCountOptions,
): Promise<ParsedResultSnapshotManifest | null> {
  const repository = options.repository ?? sourceWorkflowRuntime
  const readSnapshotManifest =
    options.readSnapshotManifest ?? readParsedResultSnapshotManifest
  const snapshot = await repository.getParseSnapshotMetadata(
    source.workspaceId,
    source.id,
  )
  if (!isCompleteSnapshot(snapshot)) return null

  return readSnapshotManifest({
    workspaceId: source.workspaceId,
    sourceId: source.id,
    manifestKey: snapshot.snapshotManifestKey,
  })
}

function isCompleteSnapshot(
  snapshot:
    | {
        readonly snapshotManifestKey?: string | null
        readonly snapshotManifestUrl?: string | null
      }
    | null,
): snapshot is {
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
