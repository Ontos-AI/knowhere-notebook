import { afterEach, describe, expect, it, vi } from "vitest"

import type { Source } from "@/infrastructure/db/schema"

const mocks = vi.hoisted(() => ({
  completeResultZipMultipartUpload: vi.fn(),
  createResultZipMultipartUploadPlan: vi.fn(),
  getResultZipPartRange: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  makeKnowhereClient: vi.fn(),
  markSourceReadyAfterReconciliation: vi.fn(),
  pollSourceReconciliation: vi.fn(),
  prepareParsedResultAssetBatch: vi.fn(),
  uploadResultZipPart: vi.fn(),
  findInWorkspace: vi.fn(),
  getParseResultProgress: vi.fn(),
  markFailed: vi.fn(),
  markParsing: vi.fn(),
  mergeParseAssetUrls: vi.fn(),
}))

vi.mock("@/domains/sources/parsed-result-assets", () => ({
  completeResultZipMultipartUpload: mocks.completeResultZipMultipartUpload,
  createResultZipMultipartUploadPlan: mocks.createResultZipMultipartUploadPlan,
  getResultZipPartRange: mocks.getResultZipPartRange,
  prepareParsedResultAssetBatch: mocks.prepareParsedResultAssetBatch,
  uploadResultZipPart: mocks.uploadResultZipPart,
}))

vi.mock("@/domains/sources/source-reconcile-workflow", () => ({
  markSourceReadyAfterReconciliation: mocks.markSourceReadyAfterReconciliation,
  pollSourceReconciliation: mocks.pollSourceReconciliation,
}))

vi.mock("@/domains/sources/workflow-runtime", () => ({
  sourceWorkflowRuntime: {
    findInWorkspace: mocks.findInWorkspace,
    getParseResultProgress: mocks.getParseResultProgress,
    markFailed: mocks.markFailed,
    markParsing: mocks.markParsing,
    mergeParseAssetUrls: mocks.mergeParseAssetUrls,
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

  it("defaults legacy payloads to the poll-and-mirror phase", () => {
    expect(
      sourceReconcileRouteWorkflow.normalizeReconcilePayload({
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "jwt_1",
      }),
    ).toEqual({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      apiKey: "jwt_1",
      phase: "poll-and-mirror",
      segmentIndex: 0,
    })
  })

  it("mirrors the ZIP and triggers asset continuation without running asset batches inline", async () => {
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
    mocks.createResultZipMultipartUploadPlan.mockResolvedValue({
      pathname: "result.zip",
      key: "blob-key",
      uploadId: "upload-1",
      sizeBytes: 10,
      partSizeBytes: 10,
      partCount: 1,
    })
    mocks.getResultZipPartRange.mockReturnValue({
      startByte: 0,
      endByte: 9,
    })
    mocks.uploadResultZipPart.mockResolvedValue({
      etag: "etag-1",
      partNumber: 1,
    })
    mocks.completeResultZipMultipartUpload.mockResolvedValue({
      url: "https://blob.example/result.zip",
    })
    mocks.mergeParseAssetUrls.mockResolvedValue({ id: "parse_result_1" })
    mocks.markParsing.mockResolvedValue(makeSource())

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

    expect(mocks.mergeParseAssetUrls).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      {
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {},
      },
    )
    expect(mocks.markParsing).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      "job_1",
      "doc_1",
      "parsing",
    )
    expect(mocks.prepareParsedResultAssetBatch).not.toHaveBeenCalled()
    expect(continuations).toEqual([
      {
        url: "https://notebook.example/api/sources/reconcile",
        payload: {
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
          phase: "asset-batches",
          segmentIndex: 0,
        },
        workflowRunId: sourceReconcileRouteWorkflow.getAssetWorkflowRunId(
          "source_1",
          0,
        ),
      },
    ])
  })

  it("resumes asset continuation without remirroring an already saved ZIP", async () => {
    vi.setSystemTime(new Date("2026-06-30T03:20:00.000Z"))
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
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })
    mocks.getParseResultProgress.mockResolvedValue({
      resultBlobUrl: "https://blob.example/result.zip",
      assetUrlsByFilePath: {
        "images/image-1.png": "https://blob.example/images/image-1.png",
      },
    })
    mocks.markParsing.mockResolvedValue(makeSource())

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
      vi.useRealTimers()
    }

    const resumeSegmentIndex = new Date("2026-06-30T03:20:00.000Z").getTime()
    expect(mocks.createResultZipMultipartUploadPlan).not.toHaveBeenCalled()
    expect(mocks.uploadResultZipPart).not.toHaveBeenCalled()
    expect(mocks.completeResultZipMultipartUpload).not.toHaveBeenCalled()
    expect(mocks.mergeParseAssetUrls).not.toHaveBeenCalled()
    expect(mocks.markParsing).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      "job_1",
      "doc_1",
      "parsing",
    )
    expect(continuations).toEqual([
      {
        url: "https://notebook.example/api/sources/reconcile",
        payload: {
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
          phase: "asset-batches",
          segmentIndex: resumeSegmentIndex,
        },
        workflowRunId: sourceReconcileRouteWorkflow.getAssetWorkflowRunId(
          "source_1",
          resumeSegmentIndex,
        ),
      },
    ])
  })

  it("reuses the asset resume segment during workflow replay", async () => {
    vi.setSystemTime(new Date("2026-06-30T03:20:00.000Z"))
    const stepResults = new Map<string, unknown>()
    const context = createWorkflowContext(stepResults)
    const continuations: ContinuationTriggerInput[] = []
    const restore =
      sourceReconcileRouteWorkflow.setContinuationTriggerForTesting(
        async (input) => {
          continuations.push(input)
        },
      )
    mocks.makeKnowhereClient.mockReturnValue({ jobs: {} })
    mocks.pollSourceReconciliation.mockResolvedValue({
      kind: "ready-to-prepare",
      jobId: "job_1",
      documentId: "doc_1",
    })
    mocks.getParseResultProgress.mockResolvedValue({
      resultBlobUrl: "https://blob.example/result.zip",
      assetUrlsByFilePath: {
        "images/image-1.png": "https://blob.example/images/image-1.png",
      },
    })
    mocks.markParsing.mockResolvedValue(makeSource())

    try {
      await sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
        context,
        payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
        }),
      })
      vi.setSystemTime(new Date("2026-06-30T03:20:14.000Z"))
      await sourceReconcileRouteWorkflow.runPollAndMirrorWorkflow({
        context: createWorkflowContext(stepResults),
        payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
        }),
      })
    } finally {
      restore()
      vi.useRealTimers()
    }

    const resumeSegmentIndex = new Date("2026-06-30T03:20:00.000Z").getTime()
    expect(continuations).toHaveLength(1)
    expect(continuations[0]?.workflowRunId).toBe(
      sourceReconcileRouteWorkflow.getAssetWorkflowRunId(
        "source_1",
        resumeSegmentIndex,
      ),
    )
    expect([...stepResults.keys()]).toContain(
      `trigger-asset-continuation-${resumeSegmentIndex}`,
    )
    expect([...stepResults.keys()]).not.toContain(
      `trigger-asset-continuation-${new Date(
        "2026-06-30T03:20:14.000Z",
      ).getTime()}`,
    )
  })

  it("limits asset continuation work and triggers the next segment when assets remain", async () => {
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
    mocks.findInWorkspace.mockResolvedValue(
      makeSource({
        knowhereJobId: "job_1",
        knowhereDocumentId: "doc_1",
      }),
    )
    mocks.getParseResultProgress.mockResolvedValue({
      resultBlobUrl: "https://blob.example/result.zip",
      assetUrlsByFilePath: {},
    })
    mocks.prepareParsedResultAssetBatch.mockResolvedValue({
      uploadedCount: 10,
      remainingCount: 737,
      hasMore: true,
    })

    try {
      await sourceReconcileRouteWorkflow.runAssetBatchWorkflow({
        context,
        payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
          phase: "asset-batches",
          segmentIndex: 2,
        }),
      })
    } finally {
      restore()
    }

    expect(mocks.prepareParsedResultAssetBatch).toHaveBeenCalledTimes(20)
    expect(mocks.markSourceReadyAfterReconciliation).not.toHaveBeenCalled()
    expect(continuations).toEqual([
      {
        url: "https://notebook.example/api/sources/reconcile",
        payload: {
          workspaceId: "workspace_1",
          sourceId: "source_1",
          apiKey: "jwt_1",
          phase: "asset-batches",
          segmentIndex: 3,
        },
        workflowRunId: sourceReconcileRouteWorkflow.getAssetWorkflowRunId(
          "source_1",
          3,
        ),
      },
    ])
  })

  it("marks the source ready when the asset continuation has no remaining work", async () => {
    const context = createWorkflowContext()
    mocks.makeKnowhereClient.mockReturnValue({ jobs: {} })
    mocks.findInWorkspace.mockResolvedValue(
      makeSource({
        knowhereJobId: "job_1",
        knowhereDocumentId: "doc_1",
      }),
    )
    mocks.getParseResultProgress.mockResolvedValue({
      resultBlobUrl: "https://blob.example/result.zip",
      assetUrlsByFilePath: {},
    })
    mocks.prepareParsedResultAssetBatch.mockResolvedValue({
      uploadedCount: 0,
      remainingCount: 0,
      hasMore: false,
    })
    mocks.markSourceReadyAfterReconciliation.mockResolvedValue({
      status: "ready",
    })

    await sourceReconcileRouteWorkflow.runAssetBatchWorkflow({
      context,
      payload: sourceReconcileRouteWorkflow.normalizeReconcilePayload({
        workspaceId: "workspace_1",
        sourceId: "source_1",
        apiKey: "jwt_1",
        phase: "asset-batches",
      }),
    })

    expect(mocks.markSourceReadyAfterReconciliation).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      documentId: "doc_1",
    })
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
          phase: "poll-and-mirror",
          segmentIndex: 5,
        },
        workflowRunId: sourceReconcileRouteWorkflow.getPollWorkflowRunId(
          "source_1",
          5,
        ),
      },
    ])
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

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "source.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "parsing",
    failureReason: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-06-30T00:00:00.000Z"),
    updatedAt: new Date("2026-06-30T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  }
}
