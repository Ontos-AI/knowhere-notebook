import { describe, expect, it, vi } from "vitest"

import type { Source, Workspace } from "@/infrastructure/db/schema"

const mocks = vi.hoisted(() => ({
  getAuthenticatedWithClient: vi.fn(),
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
    upsertMaterializedDemoSource: mocks.upsertMaterializedDemoSource,
  },
}))

import { POST } from "./route"

describe("POST /api/demo-sources/materialize", () => {
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
          url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
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
          documentId: "doc_user_copy",
          originalFile: {
            url: "/api/demo-sources/demo-tsla-q4-2025/original",
            mimeType: "application/pdf",
            sizeBytes: 5648867,
            canDownload: false,
          },
          chunkCount: 70,
        },
      ],
    })
    expect(response.status).toBe(200)
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
        originalBlobUrl: "/api/demo-sources/demo-tsla-q4-2025/original",
      },
    )
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

function makeSource(workspaceId: string): Source {
  return {
    id: "source_demo",
    workspaceId,
    title: "TSLA-Q4-2025-Update.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5648867,
    status: "ready",
    failureReason: null,
    knowhereJobId: null,
    knowhereDocumentId: "doc_user_copy",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: "/api/demo-sources/demo-tsla-q4-2025/original",
    demoKey: "demo-tsla-q4-2025",
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
  }
}
