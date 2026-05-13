import { serve } from "@upstash/workflow/nextjs"

import { reconcileSourcesForWorkspace } from "@/domains/sources/reconcile"
import { makeKnowhereClient } from "@/integrations/knowhere"
import { logger } from "@/lib/logger"

type ReconcilePayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly apiKey: string
}

const MAX_POLL_ATTEMPTS = 60
const INITIAL_DELAY_S = 3
const MAX_DELAY_S = 30

export const { POST } = serve<ReconcilePayload>(async (context) => {
  const { workspaceId, sourceId, apiKey } = context.requestPayload
  const workspace = { id: workspaceId }
  const client = makeKnowhereClient(apiKey)
  let delay = INITIAL_DELAY_S

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const resolved = await context.run(`poll-${attempt}`, async () => {
      const sources = await reconcileSourcesForWorkspace(workspace, client)
      const source = sources.find((s) => s.id === sourceId)
      if (!source || source.status !== "parsing") {
        return { done: true, status: source?.status ?? "gone" } as const
      }
      return { done: false } as const
    })

    if (resolved.done) {
      logger.info("workflow: source resolved", {
        sourceId,
        status: resolved.status,
        attempts: attempt + 1,
      })
      return
    }

    await context.sleep(`wait-${attempt}`, delay)
    delay = Math.min(Math.round(delay * 1.5), MAX_DELAY_S)
  }

  logger.error("workflow: exhausted poll attempts", {
    sourceId,
    maxAttempts: MAX_POLL_ATTEMPTS,
  })
})
