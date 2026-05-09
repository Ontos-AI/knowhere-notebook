import "server-only"

import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "./schema"
import {
  storeParsedResultAssets,
  type StoreParsedResultAssetsInput,
  type StoredParsedResultAssets,
} from "./parsed-result-assets"
import {
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
        await updateSourceFromJob(workspace.id, source.id, job, client, deps)
      } catch {
        // Leave the current row as-is on transient API errors.
      }
    }),
  )

  return await listSourcesForWorkspace(workspace.id)
}

async function updateSourceFromJob(
  workspaceId: string,
  sourceId: string,
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
        sourceId,
        job,
        client,
      })
      await saveParseResult(workspaceId, sourceId, stored)
      await markSourceReady(workspaceId, sourceId, job.documentId)
      return
    }
    await markSourceFailed(
      workspaceId,
      sourceId,
      "Parsing finished but no document was published.",
    )
    return
  }

  if (job.isFailed || job.status === "failed") {
    await markSourceFailed(
      workspaceId,
      sourceId,
      job.error?.message ?? "Parsing failed.",
    )
  }
}
