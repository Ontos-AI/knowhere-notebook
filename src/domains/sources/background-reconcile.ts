import "server-only"

import { Effect } from "effect"
import { Client } from "@upstash/workflow"

import { logger } from "@/lib/logger"
import { makeKnowhereClient } from "@/integrations/knowhere"
import {
  markSourceReadyAfterReconciliation,
  pollSourceReconciliation,
} from "./source-reconcile-workflow"

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
// Local (no-QStash) poll fallback
// ---------------------------------------------------------------------------
//
// Self-hosted deployments usually have no QSTASH_TOKEN, so the Upstash
// workflow trigger is skipped and parsing sources would stay "parsing"
// forever. When QStash is unavailable, poll the Knowhere job from this
// process with backoff (mirroring the workflow's poll-and-ready loop) and
// mark the source ready once the job is done.

const localPollMaxAttempts = 25
const localPollInitialDelayMs = 3_000
const localPollMaxDelayMs = 30_000

const activeLocalPollersBySourceId: Map<string, true> = new Map()

function runLocalReconciliation(
  workspaceId: string,
  sourceId: string,
  apiKey: string,
): void {
  if (activeLocalPollersBySourceId.has(sourceId)) return
  activeLocalPollersBySourceId.set(sourceId, true)

  const client = makeKnowhereClient(apiKey)
  let delayMs = localPollInitialDelayMs
  let finished = false

  const finish = (): void => {
    if (finished) return
    finished = true
    activeLocalPollersBySourceId.delete(sourceId)
  }

  const scheduleNext = (attempt: number): void => {
    setTimeout(() => {
      void pollOnce(attempt)
    }, delayMs)
    delayMs = Math.min(Math.round(delayMs * 1.5), localPollMaxDelayMs)
  }

  const pollOnce = async (attempt: number): Promise<void> => {
    if (attempt >= localPollMaxAttempts) {
      logger.warn(
        "background-reconcile: local poll exhausted attempts; source stays parsing",
        { sourceId, workspaceId, attempts: attempt },
      )
      finish()
      return
    }

    try {
      const poll = await pollSourceReconciliation({
        workspaceId,
        sourceId,
        client,
      })

      if (poll.kind === "resolved") {
        logger.info("background-reconcile: local poll resolved", {
          sourceId,
          workspaceId,
          status: poll.status,
          attempts: attempt + 1,
        })
        finish()
        return
      }

      if (poll.kind === "ready-to-prepare") {
        const ready = await markSourceReadyAfterReconciliation({
          workspaceId,
          sourceId,
          documentId: poll.documentId,
        })
        logger.info("background-reconcile: local poll marked source ready", {
          sourceId,
          workspaceId,
          status: ready.status,
          attempts: attempt + 1,
        })
        finish()
        return
      }

      // Still parsing: wait and poll again.
      scheduleNext(attempt + 1)
    } catch (error) {
      logger.error("background-reconcile: local poll attempt failed", {
        sourceId,
        workspaceId,
        attempt: attempt + 1,
        message: error instanceof Error ? error.message : String(error),
      })
      scheduleNext(attempt + 1)
    }
  }

  void pollOnce(0)
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
      // No Upstash: poll locally so self-hosted uploads still resolve from
      // parsing to ready without a webhook service.
      logger.info(
        "background-reconcile: QSTASH_TOKEN not set; polling locally",
        { sourceId, workspaceId },
      )
      runLocalReconciliation(workspaceId, sourceId, apiKey)
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
