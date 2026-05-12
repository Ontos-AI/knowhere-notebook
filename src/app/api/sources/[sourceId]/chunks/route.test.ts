import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ensureApiKeyForWorkspace: vi.fn(),
  ensureWorkspace: vi.fn(),
  fetchDemoChunkPage: vi.fn(),
  findSourceInWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  getSourceParseAssetUrls: vi.fn(),
  makeKnowhereClient: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}))

vi.mock("@/integrations/dashboard/api-key-service", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}))

vi.mock("@/integrations/knowhere-demo", () => ({
  knowhereDemoApi: {
    fetchCatalog: vi.fn(),
    fetchChunkPage: mocks.fetchDemoChunkPage,
  },
}))

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireUser: mocks.requireUser,
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}))

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    findInWorkspace: mocks.findSourceInWorkspace,
    getParseAssetUrls: mocks.getSourceParseAssetUrls,
  },
}))

vi.mock("@/domains/workspace/service", () => ({
  workspaceService: {
    ensureWorkspace: mocks.ensureWorkspace,
  },
}))

import { GET } from "./route"

describe("GET /api/sources/[sourceId]/chunks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("serves API-owned demo chunks for anonymous canonical demo sources", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.fetchDemoChunkPage.mockResolvedValue({
      demoSourceId: "demo-tsla-q4-2025",
      canonicalDocumentId: "demo-doc-tsla-q4-2025",
      title: "TSLA-Q4-2025-Update.pdf",
      mimeType: "application/pdf",
      chunks: [
        {
          id: "demo-tsla-q4-2025:chunk_1",
          chunkId: "chunk_1",
          chunkType: "text",
          content: "Tesla demo content",
          sectionPath: "Summary",
          sourceChunkPath: "Summary",
          filePath: null,
          sortOrder: 0,
          metadata: {},
          assetUrl: null,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 70,
        totalPages: 70,
      },
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/demo-tsla-q4-2025/chunks?page=1&pageSize=1",
      ),
      { params: Promise.resolve({ sourceId: "demo-tsla-q4-2025" }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          chunkId: "demo-tsla-q4-2025:chunk_1",
          documentId: "demo-doc-tsla-q4-2025",
          sourceTitle: "TSLA-Q4-2025-Update.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 70,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.fetchDemoChunkPage).toHaveBeenCalledWith({
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 1,
    })
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled()
    expect(mocks.makeKnowhereClient).not.toHaveBeenCalled()
    expect(mocks.getSourceParseAssetUrls).not.toHaveBeenCalled()
  })
})
