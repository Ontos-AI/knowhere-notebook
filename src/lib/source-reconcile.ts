import "server-only"

import { Effect } from "effect"
import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source, Workspace } from "./schema"
import {
  listSourcesForWorkspace,
  markSourceFailed,
  markSourceReady,
} from "./workspace"

export async function reconcileSourcesForWorkspace(
  workspace: Workspace,
  client: Knowhere,
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
        await updateSourceFromJob(workspace.id, source.id, job)
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
): Promise<void> {
  if (job.isDone || job.status === "done") {
    if (job.documentId) {
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
