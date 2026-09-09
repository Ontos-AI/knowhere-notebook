import { serve } from "@upstash/workflow/nextjs"

import {
  normalizeMemoryDistillPayload,
  runMemoryDistillWorkflow,
  type MemoryDistillPayload,
} from "@/domains/memory/distill-workflow"
import { logger } from "@/lib/logger"

export const { POST } = serve<MemoryDistillPayload>(
  async (context) => {
    const payload = normalizeMemoryDistillPayload(context.requestPayload)
    if (!payload) {
      logger.warn("memory: distill workflow received invalid payload")
      return
    }
    await runMemoryDistillWorkflow({ context, payload })
  },
  {
    failureFunction: async ({ context, failResponse }) => {
      logger.error("memory: distill workflow failed", {
        payload: context.requestPayload,
        failResponse,
      })
    },
  },
)
