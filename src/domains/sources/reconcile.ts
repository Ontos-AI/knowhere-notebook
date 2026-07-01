import "server-only"

import { Effect, pipe } from "effect"
import { del } from "@vercel/blob"
import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"
import { applyKnowhereJobToSource } from "./lifecycle"
import { sourceWorkflowRuntime } from "./workflow-runtime"

type SourceReconcileDependencies = {
  deleteStagedSourceBlob?: (pathname: string) => Promise<void>
  clearSourceStagedBlob?: (
    workspaceId: string,
    sourceId: string,
  ) => Promise<unknown>
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

export const reconcileSourcesForWorkspaceEffect = Effect.fn(
  "reconcileSourcesForWorkspace",
)(
  function* (
    workspace: { readonly id: string },
    client: Knowhere,
    deps: SourceReconcileDependencies = {},
  ) {
    const rows = yield* Effect.tryPromise(() =>
      sourceWorkflowRuntime.listForWorkspace(workspace.id),
    )
    const parsing = rows.filter(
      (row) => row.status === "parsing" && row.knowhereJobId,
    )
    if (parsing.length === 0) return rows

    logger.info("reconcile: found sources in parsing state", {
      workspaceId: workspace.id,
      count: parsing.length,
      sourceIds: parsing.map((s) => s.id),
    })

    yield* pipe(
      parsing,
      Effect.forEach(
        (source) =>
          Effect.gen(function* () {
            const jobId = source.knowhereJobId!
            logger.info("reconcile: checking Knowhere job status", {
              sourceId: source.id,
              jobId,
            })
            const job = yield* Effect.tryPromise(() => client.jobs.get(jobId))
            logger.info("reconcile: Knowhere job status", {
              sourceId: source.id,
              jobId,
              jobStatus: job.status,
              isDone: job.isDone,
              isFailed: job.isFailed,
              hasDocumentId: Boolean(job.documentId),
            })
            yield* Effect.tryPromise(() =>
              updateSourceFromJob(workspace.id, source, job, client, deps),
            )
          }).pipe(
            Effect.catchAllCause((cause) => {
              logger.error("reconcile: failed to process source", {
                sourceId: source.id,
                jobId: source.knowhereJobId,
                error: String(cause),
              })
              return Effect.void
            }),
          ),
        { concurrency: "unbounded" },
      ),
    )

    return yield* Effect.tryPromise(() =>
      sourceWorkflowRuntime.listForWorkspace(workspace.id),
    )
  },
)

// ---------------------------------------------------------------------------
// Async wrapper (backward-compatible)
// ---------------------------------------------------------------------------

export async function reconcileSourcesForWorkspace(
  workspace: { readonly id: string },
  client: Knowhere,
  deps: SourceReconcileDependencies = {},
): Promise<Source[]> {
  return Effect.runPromise(
    reconcileSourcesForWorkspaceEffect(workspace, client, deps),
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    repository: {
      markSourceReady: sourceWorkflowRuntime.markReady,
      markSourceFailed: sourceWorkflowRuntime.markFailed,
      clearSourceStagedBlob:
        deps.clearSourceStagedBlob ?? sourceWorkflowRuntime.clearStagedBlob,
    },
    blobStore: {
      deleteStagedSourceBlob: deps.deleteStagedSourceBlob ?? del,
    },
  })
}
