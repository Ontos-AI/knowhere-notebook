import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  acquireSyncCapacity: vi.fn(),
  makeKnowhereClientWithParsedStorage: vi.fn(),
  releaseSyncCapacity: vi.fn(),
  updateSyncStatus: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  ensureFreshKnowhereApiKey: vi.fn(async (apiKey: string) => apiKey),
  withFreshKnowhereApiKey: vi.fn(
    async (apiKey: string, run: (apiKey: string) => Promise<unknown>) => ({
      result: await run(apiKey),
      apiKey,
    }),
  ),
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClientWithParsedStorage: mocks.makeKnowhereClientWithParsedStorage,
}))

vi.mock("@/integrations/dashboard/api-key-service", () => ({
  ensureFreshKnowhereApiKey: mocks.ensureFreshKnowhereApiKey,
  withFreshKnowhereApiKey: mocks.withFreshKnowhereApiKey,
}))

vi.mock("./workflow-runtime", () => ({
  sourceWorkflowRuntime: {
    updateSyncStatus: mocks.updateSyncStatus,
  },
}))

vi.mock("./parsed-document-sync-capacity", () => ({
  parsedDocumentSyncCapacityGuard: {
    acquire: mocks.acquireSyncCapacity,
    release: mocks.releaseSyncCapacity,
  },
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
  beforeEach(() => {
    mocks.acquireSyncCapacity.mockResolvedValue({
      kind: "acquired",
      leaseToken: "lease_1",
      activeCounts: {
        globalActive: 0,
        workspaceActive: 0,
        documentActive: 0,
      },
    })
    mocks.releaseSyncCapacity.mockResolvedValue(undefined)
    mocks.ensureFreshKnowhereApiKey.mockImplementation(async (apiKey: string) => apiKey)
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

  it("records completion when sync completes in one segment", async () => {
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: true,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
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
    expect(mocks.releaseSyncCapacity).toHaveBeenCalledWith({
      leaseToken: "lease_1",
      releaseReason: "completed",
    })
  })

  it("triggers a continuation when sync is incomplete", async () => {
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: false,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    const triggered: Array<{
      workflowRunId: string
      segmentIndex?: number
      apiKey?: string
    }> = []
    const restore = parsedSyncRouteWorkflow.setContinuationTriggerForTesting(
      async (input) => {
        triggered.push({
          workflowRunId: input.workflowRunId,
          segmentIndex: input.payload.segmentIndex,
          apiKey: input.payload.apiKey,
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

    expect(triggered).toHaveLength(1)
    expect(triggered[0]?.segmentIndex).toBe(1)
    expect(triggered[0]?.workflowRunId).toBe("doc_1-sync-rev_1-1")
    expect(triggered[0]?.apiKey).toBe("key_1")
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "running" },
    )
    expect(mocks.releaseSyncCapacity).toHaveBeenCalledWith({
      leaseToken: "lease_1",
      releaseReason: "incomplete",
    })
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

    await parsedSyncRouteWorkflow.runParsedSyncWorkflow({
      context: createContext(),
      payload: { ...basePayload, revisionKey: "rev_9" },
    })

    expect(syncParsedDocument).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "rev_9",
    })
  })

  it("schedules a delayed retry when capacity is full", async () => {
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: true,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    mocks.acquireSyncCapacity.mockResolvedValue({
      kind: "capacity-full",
      reason: "workspace",
      waitSeconds: 60,
      activeCounts: {
        globalActive: 10,
        workspaceActive: 5,
        documentActive: 0,
      },
    })
    const triggered: Array<{
      readonly workflowRunId: string
      readonly segmentIndex?: number
      readonly delaySeconds?: number
      readonly apiKey?: string
    }> = []
    const restore = parsedSyncRouteWorkflow.setContinuationTriggerForTesting(
      async (input) => {
        triggered.push({
          workflowRunId: input.workflowRunId,
          segmentIndex: input.payload.segmentIndex,
          delaySeconds: input.delaySeconds,
          apiKey: input.payload.apiKey,
        })
      },
    )

    try {
      await parsedSyncRouteWorkflow.runParsedSyncWorkflow({
        context: createContext(),
        payload: { ...basePayload, revisionKey: "rev_1" },
      })
    } finally {
      restore()
    }

    expect(syncParsedDocument).not.toHaveBeenCalled()
    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      {
        revisionKey: "rev_1",
        syncStatus: "pending",
        syncError: null,
      },
    )
    expect(triggered).toEqual([
      {
        workflowRunId: "doc_1-sync-rev_1-1",
        segmentIndex: 1,
        delaySeconds: 60,
        apiKey: "key_1",
      },
    ])
    expect(mocks.releaseSyncCapacity).not.toHaveBeenCalled()
  })

  it("forwards a refreshed Knowhere JWT on sync continuation and capacity retry", async () => {
    mocks.ensureFreshKnowhereApiKey.mockResolvedValue("jwt_refreshed")
    mocks.withFreshKnowhereApiKey.mockImplementation(
      async (_apiKey: string, run: (apiKey: string) => Promise<unknown>) => ({
        result: await run("jwt_refreshed"),
        apiKey: "jwt_refreshed",
      }),
    )
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: false,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    const triggered: Array<{ apiKey?: string }> = []
    const restore = parsedSyncRouteWorkflow.setContinuationTriggerForTesting(
      async (input) => {
        triggered.push({ apiKey: input.payload.apiKey })
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

    expect(mocks.ensureFreshKnowhereApiKey).toHaveBeenCalledWith("key_1")
    expect(syncParsedDocument).toHaveBeenCalled()
    expect(triggered[0]?.apiKey).toBe("jwt_refreshed")
  })

  it("does not release capacity when Upstash aborts during a planned step", async () => {
    const workflowAbort = new Error("planned workflow step")
    workflowAbort.name = "WorkflowAbort"
    const syncParsedDocument = vi.fn(async () => ({
      documentId: "doc_1",
      revisionKey: "rev_1",
      completed: true,
    }))
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: {},
      knowledge: { syncParsedDocument },
    })
    const run: RunStep = async (id, task) => {
      if (id === "sync-0-0") throw workflowAbort
      return task()
    }

    await expect(
      parsedSyncRouteWorkflow.runParsedSyncWorkflow({
        context: {
          run,
          url: "https://notebook.example/api/sources/parsed-sync",
        },
        payload: basePayload,
      }),
    ).rejects.toThrow("planned workflow step")

    expect(mocks.releaseSyncCapacity).not.toHaveBeenCalled()
    expect(mocks.updateSyncStatus).not.toHaveBeenCalled()
  })
})

describe("parsedSyncRouteWorkflow.markSyncFailedAfterWorkflowFailure", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("records failed sync metadata without failing the source", async () => {
    await parsedSyncRouteWorkflow.markSyncFailedAfterWorkflowFailure(
      { ...basePayload, revisionKey: "rev_1" },
      "boom",
    )

    expect(mocks.updateSyncStatus).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      { revisionKey: "rev_1", syncStatus: "failed", syncError: "boom" },
    )
  })
})
