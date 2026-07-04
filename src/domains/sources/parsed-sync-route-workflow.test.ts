import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  makeKnowhereClientWithParsedStorage: vi.fn(),
  updateSyncStatus: vi.fn(),
  findInWorkspace: vi.fn(),
  markFailed: vi.fn(),
  markReady: vi.fn(),
  markSourceReadyAfterReconciliation: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClientWithParsedStorage: mocks.makeKnowhereClientWithParsedStorage,
}))

vi.mock("./workflow-runtime", () => ({
  sourceWorkflowRuntime: {
    updateSyncStatus: mocks.updateSyncStatus,
    findInWorkspace: mocks.findInWorkspace,
    markFailed: mocks.markFailed,
    markReady: mocks.markReady,
  },
}))

vi.mock("./source-reconcile-workflow", () => ({
  markSourceReadyAfterReconciliation: mocks.markSourceReadyAfterReconciliation,
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.loggerInfo, error: mocks.loggerError },
}))

import { parsedSyncRouteWorkflow } from "./parsed-sync-route-workflow"

type RunStep = <T>(id: string, task: () => Promise<T> | T) => Promise<T>

function createContext(overrides: { url?: string } = {}) {
  const run: RunStep = async (_id, task) => task()
  return {
    run,
    url: overrides.url ?? "https://notebook.example/api/sources/parsed-sync",
  }
}

const basePayload = {
  workspaceId: "workspace_1",
  sourceId: "source_1",
  documentId: "doc_1",
  apiKey: "key_1",
  segmentIndex: 0,
}

describe("parsedSyncRouteWorkflow.runParsedSyncWorkflow", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("marks the source ready when sync completes in one segment", async () => {
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: true,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    mocks.markSourceReadyAfterReconciliation.mockResolvedValue({
      status: "ready",
    })

    await parsedSyncRouteWorkflow.runParsedSyncWorkflow({
      context: createContext(),
      payload: basePayload,
    })

    expect(syncParsedDocument).toHaveBeenCalledTimes(1)
    expect(syncParsedDocument).toHaveBeenCalledWith({ documentId: "doc_1" })
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
  })

  it("triggers a continuation and does not mark ready when sync is incomplete", async () => {
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: false,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    const triggered: Array<{ workflowRunId: string; segmentIndex?: number }> = []
    const restore = parsedSyncRouteWorkflow.setContinuationTriggerForTesting(
      async (input) => {
        triggered.push({
          workflowRunId: input.workflowRunId,
          segmentIndex: input.payload.segmentIndex,
        })
      },
    )

    try {
      await parsedSyncRouteWorkflow.runParsedSyncWorkflow({
        context: createContext(),
        payload: basePayload,
      })
    } finally {
      restore()
    }

    expect(mocks.markSourceReadyAfterReconciliation).not.toHaveBeenCalled()
    expect(triggered).toHaveLength(1)
    expect(triggered[0]?.segmentIndex).toBe(1)
    expect(triggered[0]?.workflowRunId).toBe("doc_1-sync-rev_1-1")
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "running" },
    )
  })

  it("passes an explicit revisionKey into syncParsedDocument when provided", async () => {
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_9",
      completed: true,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    mocks.markSourceReadyAfterReconciliation.mockResolvedValue({
      status: "ready",
    })

    await parsedSyncRouteWorkflow.runParsedSyncWorkflow({
      context: createContext(),
      payload: { ...basePayload, revisionKey: "rev_9" },
    })

    expect(syncParsedDocument).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "rev_9",
    })
  })
})

describe("parsedSyncRouteWorkflow.markSyncFailedAfterWorkflowFailure", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("fails a parsing source with failure_stage storage_sync", async () => {
    mocks.findInWorkspace.mockResolvedValue({ id: "source_1", status: "parsing" })

    await parsedSyncRouteWorkflow.markSyncFailedAfterWorkflowFailure(
      { ...basePayload, revisionKey: "rev_1" },
      "boom",
    )

    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "failed", syncError: "boom" },
    )
    expect(mocks.markFailed).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      expect.stringContaining("storage sync failed"),
      "parsing",
      "storage_sync",
    )
  })

  it("does not fail an already-ready source, only records sync_status", async () => {
    mocks.findInWorkspace.mockResolvedValue({ id: "source_1", status: "ready" })

    await parsedSyncRouteWorkflow.markSyncFailedAfterWorkflowFailure(
      basePayload,
      "boom",
    )

    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: undefined, syncStatus: "failed", syncError: "boom" },
    )
    expect(mocks.markFailed).not.toHaveBeenCalled()
  })
})
