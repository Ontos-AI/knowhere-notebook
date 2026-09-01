import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  acquireSyncCapacity: vi.fn(),
  enqueueParsedDocumentSync: vi.fn(),
  releaseSyncCapacity: vi.fn(),
  updateSyncStatus: vi.fn(),
  updateRevisionKey: vi.fn(),
  markFailed: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  makeKnowhereClientWithParsedStorage: vi.fn(),
  markSourceReadyAfterReconciliation: vi.fn(),
  pollSourceReconciliation: vi.fn(),
  withFreshKnowhereApiKey: vi.fn(
    async (apiKey: string, run: (apiKey: string) => Promise<unknown>) => ({
      result: await run(apiKey),
      apiKey,
    }),
  ),
}))

vi.mock("@/domains/sources/source-reconcile-workflow", () => ({
  markSourceReadyAfterReconciliation: mocks.markSourceReadyAfterReconciliation,
  pollSourceReconciliation: mocks.pollSourceReconciliation,
}))

vi.mock("@/domains/sources/workflow-runtime", () => ({
  sourceWorkflowRuntime: {
    markFailed: mocks.markFailed,
    updateSyncStatus: mocks.updateSyncStatus,
    updateRevisionKey: mocks.updateRevisionKey,
  },
}))

vi.mock("./parsed-document-sync-scheduler", () => ({
  enqueueParsedDocumentSync: mocks.enqueueParsedDocumentSync,
}))

vi.mock("./parsed-document-sync-capacity", () => ({
  parsedDocumentSyncCapacityGuard: {
    acquire: mocks.acquireSyncCapacity,
    release: mocks.releaseSyncCapacity,
  },
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClientWithParsedStorage:
    mocks.makeKnowhereClientWithParsedStorage,
}))

vi.mock("@/integrations/dashboard/api-key-service", () => ({
  withFreshKnowhereApiKey: mocks.withFreshKnowhereApiKey,
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}))

import { sourceReconcileRouteWorkflow } from "./source-reconcile-route-workflow"

const activeCounts = {
  globalActive: 0,
  workspaceActive: 0,
  documentActive: 0,
}

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
  beforeEach(() => {
    mocks.acquireSyncCapacity.mockResolvedValue({
      kind: "acquired",
      leaseToken: "lease_1",
      activeCounts,
    })
    mocks.releaseSyncCapacity.mockResolvedValue(undefined)
    mocks.enqueueParsedDocumentSync.mockResolvedValue(undefined)
    mocks.markSourceReadyAfterReconciliation.mockResolvedValue({
      status: "ready",
    })
    mocks.updateRevisionKey.mockResolvedValue({ id: "source_1" })
    mocks.withFreshKnowhereApiKey.mockImplementation(
      async (apiKey: string, run: (apiKey: string) => Promise<unknown>) => ({
        result: await run(apiKey),
        apiKey,
      }),
    )
  })

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

  it("marks the source ready, records pending sync, and enqueues parsed-sync", async () => {
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

    expect(wired.knowledge.syncParsedDocument).not.toHaveBeenCalled()
    expect(mocks.markSourceReadyAfterReconciliation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
    })
    expect(mocks.updateRevisionKey).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      "rev_1",
    )
    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "pending", syncError: null },
    )
    expect(mocks.enqueueParsedDocumentSync).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
      apiKey: "jwt_1",
      revisionKey: "rev_1",
    })
    expect(mocks.acquireSyncCapacity).not.toHaveBeenCalled()
    expect(mocks.releaseSyncCapacity).not.toHaveBeenCalled()
    expect(continuations).toEqual([])
  })

  it("keeps the source ready when parsed-sync enqueue fails", async () => {
    const context = createWorkflowContext()
    const wired = createClient({})
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: wired.client,
      knowledge: wired.knowledge,
    })
    mocks.enqueueParsedDocumentSync.mockRejectedValue(
      new Error("qstash unavailable"),
    )
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

    expect(wired.knowledge.syncParsedDocument).not.toHaveBeenCalled()
    expect(mocks.markSourceReadyAfterReconciliation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
    })
    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "pending", syncError: null },
    )
    expect(mocks.markFailed).not.toHaveBeenCalled()
    expect(mocks.releaseSyncCapacity).not.toHaveBeenCalled()
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

  it("forwards a refreshed Knowhere JWT on poll continuation and parsed-sync enqueue", async () => {
    const context = createWorkflowContext()
    const continuations: ContinuationTriggerInput[] = []
    const restore =
      sourceReconcileRouteWorkflow.setContinuationTriggerForTesting(
        async (input) => {
          continuations.push(input)
        },
      )
    mocks.withFreshKnowhereApiKey.mockImplementation(
      async (_apiKey: string, run: (apiKey: string) => Promise<unknown>) => ({
        result: await run("jwt_refreshed"),
        apiKey: "jwt_refreshed",
      }),
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
          apiKey: "jwt_expired",
          segmentIndex: 0,
        }),
      })
    } finally {
      restore()
    }

    expect(mocks.makeKnowhereClientWithParsedStorage).toHaveBeenCalledWith(
      "jwt_refreshed",
      { workspaceId: "workspace_1" },
    )
    expect(continuations[0]?.payload.apiKey).toBe("jwt_refreshed")
  })

  it("enqueues parsed-sync with a refreshed Knowhere JWT", async () => {
    const context = createWorkflowContext()
    mocks.withFreshKnowhereApiKey.mockImplementation(
      async (_apiKey: string, run: (apiKey: string) => Promise<unknown>) => ({
        result: await run("jwt_refreshed"),
        apiKey: "jwt_refreshed",
      }),
    )
    const wired = createClient({})
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
        apiKey: "jwt_expired",
      }),
    })

    expect(mocks.enqueueParsedDocumentSync).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
      apiKey: "jwt_refreshed",
      revisionKey: "rev_1",
    })
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
