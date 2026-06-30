import { serve } from "@upstash/workflow/nextjs"

import { sourceReconcileRouteWorkflow } from "@/domains/sources/source-reconcile-route-workflow"

type ReconcilePayload = Parameters<
  typeof sourceReconcileRouteWorkflow.normalizeReconcilePayload
>[0]

export const { POST } = serve<ReconcilePayload>(
  async (context) => {
    const payload = sourceReconcileRouteWorkflow.normalizeReconcilePayload(
      context.requestPayload,
    )
    await sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
      context,
      payload,
    })
  },
  {
    failureFunction: async ({ context, failResponse }) => {
      await sourceReconcileRouteWorkflow.markSourceFailedAfterWorkflowFailure(
        context.requestPayload,
        failResponse,
      )
    },
  },
)
