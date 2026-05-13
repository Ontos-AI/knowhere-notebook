import "server-only"

import { Effect } from "effect"
import { Client } from "@upstash/workflow"

import { sourceWorkflowRuntime } from "./workflow-runtime"
import { logger } from "@/lib/logger"

const triggeredSourceIds = new Set<string>()

function createClient(): Client {
  return new Client({ token: process.env.QSTASH_TOKEN! })
}

function resolveBaseURL(): string {
  return process.env.NOTEBOOK_PUBLIC_URL ?? "http://localhost:3000"
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const startBackgroundReconciliationEffect = (
  workspaceId: string,
  sourceId: string,
  apiKey: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (triggeredSourceIds.has(sourceId)) return
    triggeredSourceIds.add(sourceId)

    yield* Effect.tryPromise(() =>
      createClient().trigger({
        url: `${resolveBaseURL()}/api/sources/reconcile`,
        body: { workspaceId, sourceId, apiKey },
        retries: 3,
      }),
    )
    yield* Effect.logInfo(
      `background-reconcile: workflow triggered for ${sourceId}`,
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        triggeredSourceIds.delete(sourceId)
        logger.error("background-reconcile: failed to trigger workflow", {
          sourceId,
          error: String(error),
        })
      }),
    ),
  )

const reconcileStaleSourcesEffect = (
  workspaceId: string,
  apiKey: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const sources = yield* Effect.tryPromise(() =>
      sourceWorkflowRuntime.listForWorkspace(workspaceId),
    )
    for (const source of sources) {
      if (source.status === "parsing" && source.knowhereJobId) {
        yield* Effect.fork(
          startBackgroundReconciliationEffect(workspaceId, source.id, apiKey),
        )
      }
    }
  }).pipe(Effect.catchAllCause(() => Effect.void))

// ---------------------------------------------------------------------------
// Async wrappers (backward-compatible)
// ---------------------------------------------------------------------------

export async function startBackgroundReconciliation(
  workspaceId: string,
  sourceId: string,
  apiKey: string,
): Promise<void> {
  return Effect.runPromise(
    startBackgroundReconciliationEffect(workspaceId, sourceId, apiKey),
  )
}

export async function reconcileStaleSources(
  workspaceId: string,
  apiKey: string,
): Promise<void> {
  return Effect.runPromise(reconcileStaleSourcesEffect(workspaceId, apiKey))
}
