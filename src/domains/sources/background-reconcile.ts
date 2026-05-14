import "server-only"

import { Effect } from "effect"
import { Client } from "@upstash/workflow"

import { logger } from "@/lib/logger"

// Re-trigger protection: Layers 1 & 2.
//
// Layer 1 — Upstash idempotency via workflowRunId=sourceId ensures at most one
// running workflow per source, even across process restarts or multiple instances.
//
// Layer 2 — In-memory Set avoids the network call entirely when the same process
// already triggered a workflow for this source.

const triggeredSourceIds = new Set<string>()

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

    const token = process.env.QSTASH_TOKEN
    if (!token) {
      logger.warn("background-reconcile: skipping — QSTASH_TOKEN not set", {
        sourceId,
        workspaceId,
      })
      triggeredSourceIds.delete(sourceId)
      return
    }

    const url = `${resolveBaseURL()}/api/sources/reconcile`
    logger.info("background-reconcile: triggering workflow", {
      sourceId,
      workspaceId,
      url,
    })
    yield* Effect.tryPromise(async () => {
      try {
        return await new Client({ token }).trigger({
          url,
          body: { workspaceId, sourceId, apiKey },
          workflowRunId: sourceId,
          retries: 3,
        })
      } catch (err) {
        logger.error("background-reconcile: Upstash trigger threw", {
          sourceId,
          workspaceId,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        throw err
      }
    })
    yield* Effect.logInfo(
      `background-reconcile: workflow triggered for ${sourceId}`,
    )
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        triggeredSourceIds.delete(sourceId)
        logger.error("background-reconcile: failed to trigger workflow", {
          sourceId,
          workspaceId,
          cause: String(cause),
        })
      }),
    ),
  )

export async function startBackgroundReconciliation(
  workspaceId: string,
  sourceId: string,
  apiKey: string,
): Promise<void> {
  return Effect.runPromise(
    startBackgroundReconciliationEffect(workspaceId, sourceId, apiKey),
  )
}
