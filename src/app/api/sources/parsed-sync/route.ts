import { serve } from "@upstash/workflow/nextjs"

import { parsedSyncRouteWorkflow } from "@/domains/sources/parsed-sync-route-workflow"

type ParsedSyncPayload = Parameters<
  typeof parsedSyncRouteWorkflow.normalizeParsedSyncPayload
>[0]

export const { POST } = serve<ParsedSyncPayload>(
  async (context) => {
    const payload = parsedSyncRouteWorkflow.normalizeParsedSyncPayload(
      context.requestPayload,
    )
    await parsedSyncRouteWorkflow.runParsedSyncWorkflow({
      context,
      payload,
    })
  },
  {
    failureFunction: async ({ context, failResponse }) => {
      await parsedSyncRouteWorkflow.markSyncFailedAfterWorkflowFailure(
        context.requestPayload,
        failResponse,
      )
    },
  },
)
