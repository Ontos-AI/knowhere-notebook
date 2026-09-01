import { serve } from "@upstash/workflow/nextjs"

import {
  normalizeMemoryExtractPayload,
  runMemoryExtractWorkflow,
  type MemoryExtractPayload,
} from "@/domains/memory/extract-workflow"
import { logger } from "@/lib/logger"

export const { POST } = serve<MemoryExtractPayload>(
  async (context) => {
    const payload = normalizeMemoryExtractPayload(context.requestPayload)
    if (!payload) {
      logger.warn("memory: extract workflow received invalid payload")
      return
    }
    await runMemoryExtractWorkflow({ context, payload })
  },
  {
    failureFunction: async ({ context, failResponse }) => {
      logger.error("memory: extract workflow failed", {
        payload: context.requestPayload,
        failResponse,
      })
    },
  },
)
