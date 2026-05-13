import "server-only"

import { Effect, pipe } from "effect"
import { del } from "@vercel/blob"
import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import {
  storeParsedResultAssets,
  type StoreParsedResultAssetsInput,
  type StoredParsedResultAssets,
} from "./parsed-result-assets"
import { applyKnowhereJobToSource } from "./lifecycle"
import { sourceWorkflowRuntime } from "./workflow-runtime"

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

    yield* pipe(
      parsing,
      Effect.forEach(
        (source) =>
          Effect.gen(function* () {
            const jobId = source.knowhereJobId!
            const job = yield* Effect.tryPromise(() => client.jobs.get(jobId))
            yield* Effect.tryPromise(() =>
              updateSourceFromJob(workspace.id, source, job, client, deps),
            )
          }).pipe(Effect.catchAllCause(() => Effect.void)),
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
    client,
    repository: {
      saveSourceParseResult:
        deps.saveSourceParseResult ?? sourceWorkflowRuntime.saveParseResult,
      markSourceReady: sourceWorkflowRuntime.markReady,
      markSourceFailed: sourceWorkflowRuntime.markFailed,
      clearSourceStagedBlob:
        deps.clearSourceStagedBlob ?? sourceWorkflowRuntime.clearStagedBlob,
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
