import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  enqueueParsedDocumentSync: vi.fn(),
  updateSyncStatus: vi.fn(),
  markFailed: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  makeKnowhereClientWithParsedStorage: vi.fn(),
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
    updateSyncStatus: mocks.updateSyncStatus,
  },
}))

vi.mock("./parsed-document-sync-scheduler", () => ({
  enqueueParsedDocumentSync: mocks.enqueueParsedDocumentSync,
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClientWithParsedStorage:
    mocks.makeKnowhereClientWithParsedStorage,
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}))

import { sourceReconcileRouteWorkflow } from "./source-reconcile-route-workflow"

function createClient(overrides: {
  syncParsedDocument?: ReturnType<typeof vi.fn>
  jobResultId?: string
  jobId?: string
}) {
  const listChunks = vi.fn(async () => ({
    jobResultId: overrides.jobResultId ?? "rev_1",
    jobId: overrides.jobId ?? "job_1",
  }))
  return {
    client: { jobs: {}, documents: { listChunks } },
    knowledge: {
      syncParsedDocument:
        overrides.syncParsedDocument ??
        vi.fn(async () => ({
          documentId: "doc_1",
          revisionKey: "rev_1",
          completed: true,
        })),
    },
    listChunks,
  }
}

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

  it("syncs the parsed document then marks the source ready", async () => {
    const context = createWorkflowContext()
    const continuations: ContinuationTriggerInput[] = []
    const restore =
      sourceReconcileRouteWorkflow.setContinuationTriggerForTesting(
        async (input) => {
          continuations.push(input)
        },
      )
    const wired = createClient({})
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: wired.client,
      knowledge: wired.knowledge,
    })
    mocks.markSourceReadyAfterReconciliation.mockResolvedValue({
      status: "ready",
    })
    mocks.pollSourceReconciliation.mockResolvedValue({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
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

    expect(wired.knowledge.syncParsedDocument).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "rev_1",
    })
    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "completed" },
    )
    expect(mocks.markSourceReadyAfterReconciliation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
    })
    expect(mocks.enqueueParsedDocumentSync).not.toHaveBeenCalled()
    expect(continuations).toEqual([])
  })

  it("hands off to parsed-sync and stays parsing when sync is incomplete", async () => {
    const context = createWorkflowContext()
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: false,
    }))
    const wired = createClient({ syncParsedDocument })
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: wired.client,
      knowledge: wired.knowledge,
    })
    mocks.pollSourceReconciliation.mockResolvedValue({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })

    await sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
      context,
      payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "jwt_1",
      }),
    })

    expect(mocks.markSourceReadyAfterReconciliation).not.toHaveBeenCalled()
    expect(mocks.enqueueParsedDocumentSync).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
      apiKey: "jwt_1",
      revisionKey: "rev_1",
    })
  })

  it("fails the source with storage_sync stage when sync throws", async () => {
    const context = createWorkflowContext()
    const syncParsedDocument = vi.fn(async () => {
      throw new Error("blob write failed")
    })
    const wired = createClient({ syncParsedDocument })
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: wired.client,
      knowledge: wired.knowledge,
    })
    mocks.pollSourceReconciliation.mockResolvedValue({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })

    await expect(
      sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
        context,
        payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
        }),
      }),
    ).rejects.toThrow("blob write failed")

    expect(mocks.markFailed).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      expect.stringContaining("storage sync failed"),
      "parsing",
      "storage_sync",
    )
    expect(mocks.markSourceReadyAfterReconciliation).not.toHaveBeenCalled()
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
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: { jobs: {}, documents: { listChunks: vi.fn() } },
      knowledge: { syncParsedDocument: vi.fn() },
    })
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
