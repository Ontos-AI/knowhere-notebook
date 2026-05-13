import "server-only"

import { Client } from "@upstash/workflow"

import { sourceWorkflowRuntime } from "./workflow-runtime"
import { logger } from "@/lib/logger"

const triggeredSourceIds = new Set<string>()

function createClient(): Client {
  return new Client({ token: process.env.QSTASH_TOKEN! })
}

function resolveBaseURL(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return process.env.NOTEBOOK_PUBLIC_URL ?? "http://localhost:3000"
}

export async function startBackgroundReconciliation(
  workspaceId: string,
  sourceId: string,
  apiKey: string,
): Promise<void> {
  if (triggeredSourceIds.has(sourceId)) return
  triggeredSourceIds.add(sourceId)

  try {
    await createClient().trigger({
      url: `${resolveBaseURL()}/api/sources/reconcile`,
      body: { workspaceId, sourceId, apiKey },
      retries: 3,
    })
    logger.info("background-reconcile: workflow triggered", { sourceId })
  } catch (error) {
    triggeredSourceIds.delete(sourceId)
    logger.error("background-reconcile: failed to trigger workflow", {
      sourceId,
      error: String(error),
    })
  }
}

export async function reconcileStaleSources(
  workspaceId: string,
  apiKey: string,
): Promise<void> {
  try {
    const sources = await sourceWorkflowRuntime.listForWorkspace(workspaceId)
    for (const source of sources) {
      if (source.status === "parsing" && source.knowhereJobId) {
        void startBackgroundReconciliation(workspaceId, source.id, apiKey)
      }
    }
  } catch {
    // Best-effort sweep; listing failures must not block the caller.
  }
}
