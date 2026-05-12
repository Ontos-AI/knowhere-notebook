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

  it("loads every API-owned demo chunk page for full anonymous chunk requests", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.fetchDemoChunkPage
      .mockResolvedValueOnce({
        demoSourceId: "demo-tsla-q4-2025",
        canonicalDocumentId: "demo-doc-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        chunks: [
          {
            id: "demo-tsla-q4-2025:chunk_1",
            chunkId: "chunk_1",
            chunkType: "text",
            content: "First page",
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
          pageSize: 200,
          total: 201,
          totalPages: 2,
        },
      })
      .mockResolvedValueOnce({
        demoSourceId: "demo-tsla-q4-2025",
        canonicalDocumentId: "demo-doc-tsla-q4-2025",
        title: "TSLA-Q4-2025-Update.pdf",
        mimeType: "application/pdf",
        chunks: [
          {
            id: "demo-tsla-q4-2025:chunk_201",
            chunkId: "chunk_201",
            chunkType: "text",
            content: "Second page",
            sectionPath: "Outlook",
            sourceChunkPath: "Outlook",
            filePath: null,
            sortOrder: 200,
            metadata: {},
            assetUrl: null,
          },
        ],
        pagination: {
          page: 2,
          pageSize: 200,
          total: 201,
          totalPages: 2,
        },
      })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/demo-tsla-q4-2025/chunks",
      ),
      { params: Promise.resolve({ sourceId: "demo-tsla-q4-2025" }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        { chunkId: "demo-tsla-q4-2025:chunk_1" },
        { chunkId: "demo-tsla-q4-2025:chunk_201" },
      ],
    })
    expect(response.status).toBe(200)
    expect(mocks.fetchDemoChunkPage).toHaveBeenNthCalledWith(1, {
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 200,
    })
    expect(mocks.fetchDemoChunkPage).toHaveBeenNthCalledWith(2, {
      demoSourceId: "demo-tsla-q4-2025",
      page: 2,
      pageSize: 200,
    })
  })

  it("loads authenticated workspace chunks without probing the demo endpoint first", async () => {
    const knowhereClient = {
      documents: {
        listChunks: vi.fn(async () => ({
          chunks: [
            {
              id: "dchk_1",
              chunkId: "parser_1",
              chunkType: "text",
              content: "Workspace chunk",
              sectionPath: "Summary",
              sourceChunkPath: "Default_Root/notes.pdf/Summary",
              filePath: null,
              metadata: {},
              sortOrder: 0,
            },
          ],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 1,
            totalPages: 1,
          },
        })),
      },
    }
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_1",
      email: null,
      name: null,
    })
    mocks.ensureWorkspace.mockResolvedValue({
      id: "workspace_1",
      userId: "user_1",
      namespace: "notebook-workspace_1",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    })
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_1",
      workspaceId: "workspace_1",
      title: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      status: "ready",
      failureReason: null,
      knowhereJobId: "job_1",
      knowhereDocumentId: "doc_1",
      stagedBlobPathname: null,
      stagedBlobUrl: null,
      originalBlobPathname: null,
      originalBlobUrl: null,
      demoKey: null,
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
      updatedAt: new Date("2026-05-10T00:00:00.000Z"),
      deletedAt: null,
    })
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.makeKnowhereClient.mockReturnValue(knowhereClient)
    mocks.getSourceParseAssetUrls.mockResolvedValue({})

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/source_1/chunks?page=1&pageSize=1",
      ),
      { params: Promise.resolve({ sourceId: "source_1" }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          chunkId: "dchk_1",
          parserChunkId: "parser_1",
          documentId: "doc_1",
          sourceTitle: "notes.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.fetchDemoChunkPage).not.toHaveBeenCalled()
    expect(knowhereClient.documents.listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 1,
      includeAssetUrls: true,
    })
  })
})
