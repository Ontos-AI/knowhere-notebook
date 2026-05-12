import "server-only"

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

export async function applyKnowhereJobToSource({
  workspaceId,
  source,
  job,
  client,
  repository,
  parsedResultStore,
  blobStore,
}: ApplyKnowhereJobToSourceInput): Promise<void> {
  if (job.isDone || job.status === "done") {
    if (job.documentId) {
      const stored = await parsedResultStore.storeParsedResultAssets({
        workspaceId,
        sourceId: source.id,
        job,
        client,
      })
      await repository.saveSourceParseResult(workspaceId, source.id, stored)
      await repository.markSourceReady(workspaceId, source.id, job.documentId)
      await cleanupStagedBlob(workspaceId, source, repository, blobStore)
      return
    }

    await repository.markSourceFailed(
      workspaceId,
      source.id,
      "Parsing finished but no document was published.",
    )
    await cleanupStagedBlob(workspaceId, source, repository, blobStore)
    return
  }

  if (job.isFailed || job.status === "failed") {
    await repository.markSourceFailed(
      workspaceId,
      source.id,
      job.error?.message ?? "Parsing failed.",
    )
    await cleanupStagedBlob(workspaceId, source, repository, blobStore)
  }
}

async function cleanupStagedBlob(
  workspaceId: string,
  source: Source,
  repository: SourceLifecycleRepository,
  blobStore: SourceLifecycleBlobStore,
): Promise<void> {
  if (!source.stagedBlobPathname) return

  try {
    await blobStore.deleteStagedSourceBlob(source.stagedBlobPathname)
    await repository.clearSourceStagedBlob(workspaceId, source.id)
  } catch {
    // Staged upload cleanup is best-effort; source state is already advanced.
  }
}
