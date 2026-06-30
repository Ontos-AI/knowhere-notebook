import "server-only"

import { Effect } from "effect"
import { Client } from "@upstash/workflow"

import { logger } from "@/lib/logger"

// Re-trigger protection: bounded process guard plus bucketed workflow IDs.
//
// Continuation workflows use deterministic run IDs, but the initial trigger
// must stay retryable after an old completed workflow run. The cooldown avoids
// duplicate same-process trigger calls without permanently blocking a source.

const triggerCooldownMs: number = 5 * 60_000
const lastTriggeredAtBySourceId: Map<string, number> = new Map()

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
    const now = Date.now()
    const lastTriggeredAt = lastTriggeredAtBySourceId.get(sourceId)
    if (
      lastTriggeredAt !== undefined &&
      now - lastTriggeredAt < triggerCooldownMs
    ) {
      return
    }
    lastTriggeredAtBySourceId.set(sourceId, now)

    const token = process.env.QSTASH_TOKEN
    if (!token) {
      logger.warn("background-reconcile: skipping — QSTASH_TOKEN not set", {
        sourceId,
        workspaceId,
      })
      lastTriggeredAtBySourceId.delete(sourceId)
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
          workflowRunId: `${sourceId}-${Math.floor(now / triggerCooldownMs)}`,
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
        lastTriggeredAtBySourceId.delete(sourceId)
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
