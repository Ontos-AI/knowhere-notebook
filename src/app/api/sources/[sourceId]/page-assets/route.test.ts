import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteBlob: vi.fn(),
  ensureApiKeyForWorkspace: vi.fn(),
  ensureWorkspace: vi.fn(),
  findSourceInWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  listChunks: vi.fn(),
  makeKnowhereClient: vi.fn(),
  makeKnowhereClientWithParsedStorage: vi.fn(),
  readChunks: vi.fn(),
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
    fetchChunkPage: vi.fn(),
  },
}))

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireUser: mocks.requireUser,
}))

vi.mock("@/integrations/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
  makeKnowhereClientWithParsedStorage:
    mocks.makeKnowhereClientWithParsedStorage,
}))

vi.mock("@vercel/blob", () => ({
  del: mocks.deleteBlob,
}))

vi.mock("@/domains/sources/service", () => ({
  sourceService: {
    findInWorkspace: mocks.findSourceInWorkspace,
    localizeRemoteDocument: vi.fn(),
  },
}))

vi.mock("@/domains/workspace/service", () => ({
  workspaceService: {
    ensureWorkspace: mocks.ensureWorkspace,
  },
}))

import { GET } from "./route"

describe("GET /api/sources/[sourceId]/page-assets", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: { documents: { listChunks: mocks.listChunks } },
      knowledge: { readChunks: mocks.readChunks },
    })
  })

  it("returns stored page assets for a ready workspace source without durable hardening", async () => {
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
    mocks.findSourceInWorkspace.mockResolvedValue(
      makeReadySource({
        id: "00000000-0000-0000-0000-000000000002",
        knowhereJobId: "job_1",
        knowhereDocumentId: "doc_1",
      }),
    )
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.readChunks.mockResolvedValue({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "parsed-storage:doc_1",
      },
      chunks: [
        {
          chunkId: "page_1",
          chunkType: "page",
          assetUrl: "https://assets.example/fallback.png",
          metadata: {
            pageAssets: [
              {
                pageNum: 1,
                assetUrl: "https://assets.example/page-000001.png",
                contentType: "image/png",
                width: 1200,
                height: 1600,
              },
            ],
          },
        },
      ],
      page: 1,
      pageSize: 1,
      totalChunks: 3,
      totalPages: 3,
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/page-assets?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      pages: [
        {
          pageNumber: 1,
          assetUrl: "https://assets.example/page-000001.png",
          contentType: "image/png",
          width: 1200,
          height: 1600,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 3,
        totalPages: 3,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "job_1",
      chunkType: "page",
      page: 1,
      pageSize: 1,
    })
    expect(mocks.listChunks).not.toHaveBeenCalled()
  })

  it("rejects non-ready workspace sources", async () => {
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
    mocks.findSourceInWorkspace.mockResolvedValue(
      makeReadySource({
        id: "00000000-0000-0000-0000-000000000002",
        status: "parsing",
        knowhereDocumentId: "doc_1",
      }),
    )

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/page-assets?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      message: "Source is not ready.",
    })
    expect(response.status).toBe(409)
    expect(mocks.readChunks).not.toHaveBeenCalled()
  })

  it("returns an empty page list when page chunks have no usable assets", async () => {
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
    mocks.findSourceInWorkspace.mockResolvedValue(
      makeReadySource({
        id: "00000000-0000-0000-0000-000000000002",
        knowhereDocumentId: "doc_1",
      }),
    )
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.readChunks.mockResolvedValue({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "remote:doc_1",
      },
      chunks: [
        {
          chunkId: "page_1",
          chunkType: "page",
          metadata: { pageAssets: [] },
        },
      ],
      page: 1,
      pageSize: 1,
      totalChunks: 1,
      totalPages: 1,
    })
    mocks.listChunks.mockResolvedValue({
      chunks: [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/page-assets?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      pages: [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 1,
      chunkType: "page",
      includeAssetUrls: true,
    })
  })

  it("returns Knowhere page asset URLs when the storage probe falls through to remote chunks", async () => {
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
    mocks.findSourceInWorkspace.mockResolvedValue(
      makeReadySource({
        id: "00000000-0000-0000-0000-000000000002",
        knowhereDocumentId: "doc_1",
      }),
    )
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.readChunks.mockResolvedValue({
      document: {
        localDocumentId: "doc_1",
        resultDirectoryPath: "remote:doc_1",
      },
      chunks: [
        {
          chunkId: "page_1",
          chunkType: "page",
          metadata: {
            pageAssets: [
              {
                pageNum: 1,
                contentType: "image/png",
                width: 1200,
                height: 1600,
              },
            ],
          },
        },
      ],
      page: 1,
      pageSize: 1,
      totalChunks: 1,
      totalPages: 1,
    })
    mocks.listChunks.mockResolvedValue({
      chunks: [
        {
          id: "document_page_1",
          chunkId: "page_1",
          chunkType: "page",
          content: "Page 1",
          sectionId: null,
          sectionPath: "pages/1",
          sourceChunkPath: "pages/1",
          filePath: "pages/page-000001.png",
          sortOrder: 0,
          metadata: {
            pageAssets: [
              {
                pageNum: 1,
                assetUrl: "https://knowhere.example/page-000001.png",
                contentType: "image/png",
                width: 1200,
                height: 1600,
              },
            ],
          },
          assetUrl: "https://knowhere.example/page-000001.png",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/page-assets?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      pages: [
        {
          pageNumber: 1,
          assetUrl: "https://knowhere.example/page-000001.png",
          contentType: "image/png",
          width: 1200,
          height: 1600,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "job_1",
      chunkType: "page",
      page: 1,
      pageSize: 1,
    })
    expect(mocks.listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 1,
      chunkType: "page",
      includeAssetUrls: true,
    })
  })

  it("marks page assets unavailable when the parsed document is missing remotely", async () => {
    const notFoundError = new Error("Document not found")
    notFoundError.name = "NotFoundError"
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
    mocks.findSourceInWorkspace.mockResolvedValue(
      makeReadySource({
        id: "00000000-0000-0000-0000-000000000002",
        knowhereDocumentId: "doc_missing",
      }),
    )
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.readChunks.mockRejectedValue(notFoundError)

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/page-assets?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      pages: [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 0,
        totalPages: 0,
      },
      message:
        "Source is unavailable. The parsed document is not available locally and could not be loaded from Knowhere.",
      isUnavailable: true,
    })
    expect(response.status).toBe(200)
  })
})

function makeReadySource(overrides: Record<string, unknown>) {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "ready",
    failureReason: null,
    failureStage: null,
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
    ...overrides,
  }
}
