import "server-only"

import { del } from "@vercel/blob"
import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "@/infrastructure/db/schema"
import {
  storeParsedResultAssets,
  type StoreParsedResultAssetsInput,
  type StoredParsedResultAssets,
} from "./parsed-result-assets"
import { applyKnowhereJobToSource } from "./lifecycle"
import { sourceService } from "./service"

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
  const rows = await sourceService.listForWorkspace(workspace.id)
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

  return await sourceService.listForWorkspace(workspace.id)
}

async function updateSourceFromJob(
  workspaceId: string,
  source: Source,
  job: JobResult,
  client: Knowhere,
  deps: SourceReconcileDependencies,
): Promise<void> {
  await applyKnowhereJobToSource({
    workspaceId,
    source,
    job,
    client,
    repository: {
      saveSourceParseResult:
        deps.saveSourceParseResult ?? sourceService.saveParseResult,
      markSourceReady: sourceService.markReady,
      markSourceFailed: sourceService.markFailed,
      clearSourceStagedBlob:
        deps.clearSourceStagedBlob ?? sourceService.clearStagedBlob,
    },
    parsedResultStore: {
      storeParsedResultAssets:
        deps.storeParsedResultAssets ?? storeParsedResultAssets,
    },
    blobStore: {
      deleteStagedSourceBlob: deps.deleteStagedSourceBlob ?? del,
    },
  })
}
