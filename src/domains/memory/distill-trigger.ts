import "server-only"

import { Client } from "@upstash/workflow"

import { DISTILL_COOLDOWN_MS, DISTILL_MIN_PENDING } from "./distill-config"
import type { MemoryDistillPayload } from "./distill-workflow"
import { memoryService } from "./service"
import { logger } from "@/lib/logger"

// Re-trigger protection: process-local cooldown + bucketed workflowRunId.
// Mirrors background-reconcile — same cooldown width keys both guards.

const lastTriggeredAtByWorkspaceId: Map<string, number> = new Map()

function resolveBaseURL(): string {
  return process.env.NOTEBOOK_PUBLIC_URL ?? "http://localhost:3000"
}

/**
 * Fire-and-forget distill trigger for one workspace.
 * Caller should already know pending may be high; this re-checks the count,
 * applies cooldown + bucketed workflowRunId, then enqueues QStash.
 */
export async function triggerMemoryDistill(
  payload: MemoryDistillPayload,
): Promise<void> {
  const pendingCount = await memoryService.countPendingObservations(
    payload.workspaceId,
  )
  if (pendingCount < DISTILL_MIN_PENDING) return

  const now = Date.now()
  const lastTriggeredAt = lastTriggeredAtByWorkspaceId.get(payload.workspaceId)
  if (
    lastTriggeredAt !== undefined &&
    now - lastTriggeredAt < DISTILL_COOLDOWN_MS
  ) {
    return
  }
  lastTriggeredAtByWorkspaceId.set(payload.workspaceId, now)

  const token = process.env.QSTASH_TOKEN
  if (!token) {
    logger.warn("memory: skipping distill — QSTASH_TOKEN not set", {
      workspaceId: payload.workspaceId,
      pendingCount,
    })
    lastTriggeredAtByWorkspaceId.delete(payload.workspaceId)
    return
  }

  const url = `${resolveBaseURL()}/api/memory/distill`
  try {
    await new Client({ token }).trigger({
      url,
      body: payload,
      workflowRunId: `${payload.workspaceId}-${Math.floor(now / DISTILL_COOLDOWN_MS)}`,
      retries: 3,
    })
    logger.info("memory: distill workflow triggered", {
      workspaceId: payload.workspaceId,
      pendingCount,
      url,
    })
  } catch (error) {
    lastTriggeredAtByWorkspaceId.delete(payload.workspaceId)
    logger.error("memory: failed to trigger distill workflow", {
      workspaceId: payload.workspaceId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Test helper: clear process-local cooldown map between cases. */
export function resetMemoryDistillTriggerStateForTests(): void {
  lastTriggeredAtByWorkspaceId.clear()
}
