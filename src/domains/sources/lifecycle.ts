import "server-only"

import { Effect } from "effect"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type {
  StoreParsedResultAssetsInput,
  StoredParsedResultAssets,
} from "./parsed-result-assets"

type SourceLifecycleRepository = {
  saveSourceParseResult(
    workspaceId: string,
    sourceId: string,
    input: StoredParsedResultAssets,
  ): Promise<unknown>
  markSourceReady(
    workspaceId: string,
    sourceId: string,
    documentId: string,
  ): Promise<unknown>
  markSourceFailed(
    workspaceId: string,
    sourceId: string,
    reason: string,
    requiredStatus?: string,
  ): Promise<unknown>
  clearSourceStagedBlob(workspaceId: string, sourceId: string): Promise<unknown>
}

type SourceLifecycleParsedResultStore = {
  storeParsedResultAssets(
    input: Omit<StoreParsedResultAssetsInput, "blobStore">,
  ): Promise<StoredParsedResultAssets>
}

type SourceLifecycleBlobStore = {
  deleteStagedSourceBlob(pathname: string): Promise<void>
}

type ApplyKnowhereJobToSourceInput = {
  workspaceId: string
  source: Source
  job: JobResult
  client: StoreParsedResultAssetsInput["client"]
  repository: SourceLifecycleRepository
  parsedResultStore: SourceLifecycleParsedResultStore
  blobStore: SourceLifecycleBlobStore
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

export const applyKnowhereJobToSourceEffect = Effect.fn(
  "applyKnowhereJobToSource",
)(
  function* ({
    workspaceId,
    source,
    job,
    client,
    repository,
    parsedResultStore,
    blobStore,
  }: ApplyKnowhereJobToSourceInput) {
    // Best-effort early exit: skip expensive asset uploads when the source has
    // already been resolved. The atomic guard (Layer 3) is in the DB UPDATE below.
    if (source.status !== "parsing") return

    if (job.isDone || job.status === "done") {
      if (job.documentId) {
        const stored = yield* Effect.tryPromise(() =>
          parsedResultStore.storeParsedResultAssets({
            workspaceId,
            sourceId: source.id,
            job,
            client,
          }),
        )
        yield* Effect.tryPromise(() =>
          repository.saveSourceParseResult(workspaceId, source.id, stored),
        )
        yield* Effect.tryPromise(() =>
          repository.markSourceReady(workspaceId, source.id, job.documentId!),
        )
        yield* cleanupStagedBlobEffect(
          workspaceId,
          source,
          repository,
          blobStore,
        )
        return
      }

      yield* Effect.tryPromise(() =>
        repository.markSourceFailed(
          workspaceId,
          source.id,
          "Parsing finished but no document was published.",
          "parsing",
        ),
      )
      yield* cleanupStagedBlobEffect(workspaceId, source, repository, blobStore)
      return
    }

    if (job.isFailed || job.status === "failed") {
      yield* Effect.tryPromise(() =>
        repository.markSourceFailed(
          workspaceId,
          source.id,
          job.error?.message ?? "Parsing failed.",
          "parsing",
        ),
      )
      yield* cleanupStagedBlobEffect(workspaceId, source, repository, blobStore)
    }
  },
)

// ---------------------------------------------------------------------------
// Async wrapper (backward-compatible)
// ---------------------------------------------------------------------------

export async function applyKnowhereJobToSource({
  workspaceId,
  source,
  job,
  client,
  repository,
  parsedResultStore,
  blobStore,
}: ApplyKnowhereJobToSourceInput): Promise<void> {
  return Effect.runPromise(
    applyKnowhereJobToSourceEffect({
      workspaceId,
      source,
      job,
      client,
      repository,
      parsedResultStore,
      blobStore,
    }),
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanupStagedBlobEffect(
  workspaceId: string,
  source: Source,
  repository: SourceLifecycleRepository,
  blobStore: SourceLifecycleBlobStore,
): Effect.Effect<void> {
  if (!source.stagedBlobPathname) return Effect.void

  return Effect.gen(function* () {
    yield* Effect.tryPromise(() =>
      blobStore.deleteStagedSourceBlob(source.stagedBlobPathname!),
    )
    yield* Effect.tryPromise(() =>
      repository.clearSourceStagedBlob(workspaceId, source.id),
    )
  }).pipe(
    Effect.catchAllCause(() => Effect.void),
  )
}
