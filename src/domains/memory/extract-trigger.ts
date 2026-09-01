import "server-only"

import { Client } from "@upstash/workflow"

import type { MemoryExtractPayload } from "./extract-workflow"
import { logger } from "@/lib/logger"

function resolveBaseURL(): string {
  return process.env.NOTEBOOK_PUBLIC_URL ?? "http://localhost:3000"
}

/**
 * Fire-and-forget trigger for the post-turn fluid-memory extraction
 * workflow. Each turn is uniquely keyed by its message ids, so unlike the
 * source reconcile trigger no cooldown/dedup guard is needed; QStash
 * retries cover transient delivery failures.
 */
export async function triggerMemoryExtraction(
  payload: MemoryExtractPayload,
): Promise<void> {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    logger.warn("memory: skipping extraction — QSTASH_TOKEN not set", {
      workspaceId: payload.workspaceId,
      assistantMessageId: payload.assistantMessageId,
    })
    return
  }

  try {
    await new Client({ token }).trigger({
      url: `${resolveBaseURL()}/api/memory/extract`,
      body: payload,
      retries: 3,
    })
  } catch (error) {
    logger.error("memory: failed to trigger extraction workflow", {
      workspaceId: payload.workspaceId,
      assistantMessageId: payload.assistantMessageId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
