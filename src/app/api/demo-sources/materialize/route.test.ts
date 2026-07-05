import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Source, Workspace } from "@/infrastructure/db/schema"

const mocks = vi.hoisted(() => ({
  getAuthenticatedWithClient: vi.fn(),
  listHiddenDemoSourceIds: vi.fn(),
  materializeSources: vi.fn(),
  upsertMaterializedDemoSource: vi.fn(),
}))

vi.mock("@/domains/workspace/request-context", () => ({
  notebookRequestContext: {
    getAuthenticatedWithClient: mocks.getAuthenticatedWithClient,
  },
}))

vi.mock("@/integrations/knowhere-demo", () => ({
  knowhereDemoApi: {
    materializeSources: mocks.materializeSources,
  },
}))

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    listHiddenDemoSourceIds: mocks.listHiddenDemoSourceIds,
    upsertMaterializedDemoSource: mocks.upsertMaterializedDemoSource,
  },
}))

import { POST } from "./route"

describe("POST /api/demo-sources/materialize", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listHiddenDemoSourceIds.mockResolvedValue([])
  })

  it("materializes selected demo sources through Knowhere and stores source rows", async () => {
    const workspace = makeWorkspace()
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      apiKey: "jwt_123",
      workspace,
    })
    mocks.materializeSources.mockResolvedValue([
      {
        demoSourceId: "demo-tsla-q4-2025",
        documentId: "doc_user_copy",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5648867,
        chunkCount: 70,
        status: "created",
        originalFile: {
          url: "https://example.com/tsla-q4-2025.pdf",
          mimeType: "application/pdf",
          sizeBytes: 5648867,
          canDownload: false,
        },
      },
    ])
    mocks.upsertMaterializedDemoSource.mockResolvedValue(
      makeSource(workspace.id),
    )

    const response = await POST(
      new Request("http://localhost:3001/api/demo-sources/materialize", {
        method: "POST",
        body: JSON.stringify({
          demoSourceIds: ["demo-tsla-q4-2025", "demo-tsla-q4-2025"],
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      sources: [
        {
          id: "source_demo",
          kind: "workspace",
          title: "TSLA-Q4-2025-Update.pdf",
          mimeType: "application/pdf",
          status: "ready",
          demoSourceId: "demo-tsla-q4-2025",
          documentId: "doc_user_copy",
          originalFile: {
            url: "https://example.com/tsla-q4-2025.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5648867,
            canDownload: false,
            pdfPreviewMode: "browser",
          },
          chunkCount: 70,
        },
      ],
    })
    expect(response.status).toBe(200)
    expect(mocks.listHiddenDemoSourceIds).toHaveBeenCalledWith(workspace.id)
    expect(mocks.materializeSources).toHaveBeenCalledWith({
      apiKey: "jwt_123",
      namespace: workspace.namespace,
      demoSourceIds: ["demo-tsla-q4-2025"],
    })
    expect(mocks.upsertMaterializedDemoSource).toHaveBeenCalledWith(
      workspace.id,
      {
        demoSourceId: "demo-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5648867,
        knowhereDocumentId: "doc_user_copy",
        originalBlobUrl: "https://example.com/tsla-q4-2025.pdf",
      },
    )
  })

  it("does not store non-public legacy demo original routes", async () => {
    const workspace = makeWorkspace()
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      apiKey: "jwt_123",
      workspace,
    })
    mocks.materializeSources.mockResolvedValue([
      {
        demoSourceId: "legacy-demo",
        documentId: "doc_legacy_copy",
        title: "Legacy-Demo.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        chunkCount: 1,
        status: "created",
        originalFile: {
          url: "https://api.knowhere.example/api/v1/demo/sources/legacy-demo/original",
          mimeType: "application/pdf",
          sizeBytes: 10,
          canDownload: false,
        },
      },
    ])
    mocks.upsertMaterializedDemoSource.mockResolvedValue(
      makeSource(workspace.id, { originalBlobUrl: null }),
    )

    const response = await POST(
      new Request("http://localhost:3001/api/demo-sources/materialize", {
        method: "POST",
        body: JSON.stringify({
          demoSourceIds: ["legacy-demo"],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.upsertMaterializedDemoSource).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({
        demoSourceId: "legacy-demo",
        originalBlobUrl: null,
      }),
    )
  })

  it("does not materialize demo sources hidden in the workspace", async () => {
    const workspace = makeWorkspace()
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      apiKey: "jwt_123",
      workspace,
    })
    mocks.listHiddenDemoSourceIds.mockResolvedValue(["demo-tsla-q4-2025"])

    const response = await POST(
      new Request("http://localhost:3001/api/demo-sources/materialize", {
        method: "POST",
        body: JSON.stringify({
          demoSourceIds: ["demo-tsla-q4-2025"],
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      message: "Selected demo sources are no longer available.",
    })
    expect(response.status).toBe(400)
    expect(mocks.materializeSources).not.toHaveBeenCalled()
    expect(mocks.upsertMaterializedDemoSource).not.toHaveBeenCalled()
  })

  it("filters hidden demo sources before materializing visible selections", async () => {
    const workspace = makeWorkspace()
    mocks.getAuthenticatedWithClient.mockResolvedValue({
      apiKey: "jwt_123",
      workspace,
    })
    mocks.listHiddenDemoSourceIds.mockResolvedValue(["hidden-demo"])
    mocks.materializeSources.mockResolvedValue([])

    const response = await POST(
      new Request("http://localhost:3001/api/demo-sources/materialize", {
        method: "POST",
        body: JSON.stringify({
          demoSourceIds: ["hidden-demo", "demo-tsla-q4-2025"],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.materializeSources).toHaveBeenCalledWith({
      apiKey: "jwt_123",
      namespace: workspace.namespace,
      demoSourceIds: ["demo-tsla-q4-2025"],
    })
  })
})

function makeWorkspace(): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
    namespace: "notebook-workspace_1",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
  }
}

function makeSource(
  workspaceId: string,
  overrides: Partial<Source> = {},
): Source {
  return {
    id: "source_demo",
    workspaceId,
    title: "TSLA-Q4-2025-Update.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5648867,
    status: "ready",
    failureReason: null,
    failureStage: null,
    knowhereJobId: null,
    knowhereDocumentId: "doc_user_copy",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: "https://example.com/tsla-q4-2025.pdf",
    demoKey: "demo-tsla-q4-2025",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  }
}
