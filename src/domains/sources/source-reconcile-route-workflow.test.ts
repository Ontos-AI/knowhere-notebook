import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  makeKnowhereClient: vi.fn(),
  markFailed: vi.fn(),
  markSourceReadyAfterReconciliation: vi.fn(),
  pollSourceReconciliation: vi.fn(),
}))

vi.mock("@/domains/sources/source-reconcile-workflow", () => ({
  markSourceReadyAfterReconciliation: mocks.markSourceReadyAfterReconciliation,
  pollSourceReconciliation: mocks.pollSourceReconciliation,
}))

vi.mock("@/domains/sources/workflow-runtime", () => ({
  sourceWorkflowRuntime: {
    markFailed: mocks.markFailed,
  },
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}))

import { sourceReconcileRouteWorkflow } from "./source-reconcile-route-workflow"

describe("sourceReconcileRouteWorkflow", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes legacy mirror and asset payloads to poll-and-ready", () => {
    expect(
      sourceReconcileRouteWorkflow.normalizeReconcilePayload({
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "jwt_1",
        phase: "asset-batches",
      }),
    ).toEqual({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      apiKey: "jwt_1",
      phase: "poll-and-ready",
      segmentIndex: 0,
    })
  })

  it("marks the source ready when Knowhere publishes a document id", async () => {
    const context = createWorkflowContext()
    const continuations: ContinuationTriggerInput[] = []
    const restore =
      sourceReconcileRouteWorkflow.setContinuationTriggerForTesting(
        async (input) => {
          continuations.push(input)
        },
      )
    const client = { jobs: {} }
    mocks.makeKnowhereClient.mockReturnValue(client)
    mocks.pollSourceReconciliation.mockResolvedValue({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })
    mocks.markSourceReadyAfterReconciliation.mockResolvedValue({
      status: "ready",
    })

    try {
      await sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
        context,
        payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
        }),
      })
    } finally {
      restore()
    }

    expect(mocks.markSourceReadyAfterReconciliation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
    })
    expect(continuations).toEqual([])
  })

  it("triggers a fresh poll run when Knowhere is still running after the segment budget", async () => {
    const context = createWorkflowContext()
    const continuations: ContinuationTriggerInput[] = []
    const restore =
      sourceReconcileRouteWorkflow.setContinuationTriggerForTesting(
        async (input) => {
          continuations.push(input)
        },
      )
    mocks.makeKnowhereClient.mockReturnValue({ jobs: {} })
    mocks.pollSourceReconciliation.mockResolvedValue({
      kind: "waiting",
      jobId: "job_1",
      jobStatus: "running",
    })

    try {
      await sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
        context,
        payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
          segmentIndex: 4,
        }),
      })
    } finally {
      restore()
    }

    expect(mocks.pollSourceReconciliation).toHaveBeenCalledTimes(25)
    expect(continuations).toEqual([
      {
        url: "https://notebook.example/api/sources/reconcile",
        payload: {
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
          phase: "poll-and-ready",
          segmentIndex: 5,
        },
        workflowRunId: sourceReconcileRouteWorkflow.getPollWorkflowRunId(
          "source_1",
          5,
        ),
      },
    ])
  })

  it("marks a parsing source failed after workflow retry exhaustion", async () => {
    mocks.markFailed.mockResolvedValue({ id: "source_1" })

    await sourceReconcileRouteWorkflow.markSourceFailedAfterWorkflowFailure(
      {
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "jwt_1",
        phase: "asset-batches",
        segmentIndex: 2,
      },
      "Retry attempts exhausted.",
    )

    expect(mocks.markFailed).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      "Source reconciliation workflow failed: Retry attempts exhausted.",
      "parsing",
    )
  })
})

type ContinuationTriggerInput = Parameters<
  typeof sourceReconcileRouteWorkflow.setContinuationTriggerForTesting
>[0] extends (input: infer Input) => Promise<void>
  ? Input
  : never

function createWorkflowContext(stepResults = new Map<string, unknown>()): {
  readonly run: <T>(stepName: string, step: () => Promise<T> | T) => Promise<T>
  readonly sleep: (stepName: string, duration: number | string) => Promise<void>
  readonly url: string
} {
  return {
    run: async <T>(stepName: string, step: () => Promise<T> | T) => {
      if (stepResults.has(stepName)) return stepResults.get(stepName) as T
      const result = await step()
      stepResults.set(stepName, result)
      return result
    },
    sleep: vi.fn(async () => undefined),
    url: "https://notebook.example/api/sources/reconcile",
  }
}
