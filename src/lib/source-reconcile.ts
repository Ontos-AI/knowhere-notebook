import "server-only"

import { del } from "@vercel/blob"
import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "./schema"
import {
  storeParsedResultAssets,
  type StoreParsedResultAssetsInput,
  type StoredParsedResultAssets,
} from "./parsed-result-assets"
import {
  clearSourceStagedBlob,
  listSourcesForWorkspace,
  markSourceFailed,
  markSourceReady,
  saveSourceParseResult,
} from "./workspace"

type SourceReconcileDependencies = {
  storeParsedResultAssets?: (
    input: Omit<StoreParsedResultAssetsInput, "blobStore">,
  ) => Promise<StoredParsedResultAssets>
  saveSourceParseResult?: (
    workspaceId: string,
    sourceId: string,
    input: StoredParsedResultAssets,
  ) => Promise<unknown>
  deleteStagedSourceBlob?: (pathname: string) => Promise<void>
  clearSourceStagedBlob?: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<unknown>
}

export async function reconcileSourcesForWorkspace(
  workspace: Workspace,
  client: Knowhere,
  deps: SourceReconcileDependencies = {},
): Promise<Source[]> {
  const rows = await listSourcesForWorkspace(workspace.id)
  const parsing = rows.filter(
    (row) => row.status === "parsing" && row.knowhereJobId,
  )
  if (parsing.length === 0) return rows

  await Promise.all(
    parsing.map(async (source) => {
      const jobId = source.knowhereJobId
      if (!jobId) return

      try {
        const job = await client.jobs.get(jobId)
        await updateSourceFromJob(workspace.id, source, job, client, deps)
      } catch {
        // Leave the current row as-is on transient API errors.
      }
    }),
  )

  return await listSourcesForWorkspace(workspace.id)
}

async function updateSourceFromJob(
  workspaceId: string,
  source: Source,
  job: JobResult,
  client: Knowhere,
  deps: SourceReconcileDependencies,
): Promise<void> {
  if (job.isDone || job.status === "done") {
    if (job.documentId) {
      const storeAssets = deps.storeParsedResultAssets ?? storeParsedResultAssets
      const saveParseResult = deps.saveSourceParseResult ?? saveSourceParseResult
      const stored = await storeAssets({
        workspaceId,
        sourceId: source.id,
        job,
        client,
      })
      await saveParseResult(workspaceId, source.id, stored)
      await deleteSourceStagedBlob(workspaceId, source, deps)
      await markSourceReady(workspaceId, source.id, job.documentId)
      return
    }
    await deleteSourceStagedBlob(workspaceId, source, deps)
    await markSourceFailed(
      workspaceId,
      source.id,
      "Parsing finished but no document was published.",
    )
    return
  }

  if (job.isFailed || job.status === "failed") {
    await deleteSourceStagedBlob(workspaceId, source, deps)
    await markSourceFailed(
      workspaceId,
      source.id,
      job.error?.message ?? "Parsing failed.",
    )
  }
}

async function deleteSourceStagedBlob(
  workspaceId: string,
  source: Source,
  deps: SourceReconcileDependencies,
): Promise<void> {
  if (!source.stagedBlobPathname) return

  const deleteBlob = deps.deleteStagedSourceBlob ?? del
  const clearStagedBlob = deps.clearSourceStagedBlob ?? clearSourceStagedBlob
  await deleteBlob(source.stagedBlobPathname)
  await clearStagedBlob(workspaceId, source.id)
}
