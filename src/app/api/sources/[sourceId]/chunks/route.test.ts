import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteBlob: vi.fn(),
  ensureApiKeyForWorkspace: vi.fn(),
  ensureWorkspace: vi.fn(),
  fetchDemoChunkPage: vi.fn(),
  findSourceInWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  listChunks: vi.fn(),
  localizeRemoteDocument: vi.fn(),
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
    fetchChunkPage: mocks.fetchDemoChunkPage,
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
    localizeRemoteDocument: mocks.localizeRemoteDocument,
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
    mocks.makeKnowhereClientWithParsedStorage.mockReturnValue({
      client: { documents: { listChunks: mocks.listChunks } },
      knowledge: { readChunks: mocks.readChunks },
    })
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

  it("serves API-owned demo chunks for authenticated canonical demo sources", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "knowhere-api-key-dev-user",
      email: null,
      name: "Knowhere API Key Development",
    })
    mocks.ensureWorkspace.mockResolvedValue({
      id: "workspace_1",
      userId: "knowhere-api-key-dev-user",
      namespace: "notebook-workspace_1",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    })
    mocks.findSourceInWorkspace.mockResolvedValue(null)
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
        pageSize: 100,
        total: 70,
        totalPages: 1,
      },
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/demo-tsla-q4-2025/chunks?page=1&pageSize=100",
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
        pageSize: 100,
        total: 70,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.fetchDemoChunkPage).toHaveBeenCalledWith({
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 100,
    })
    expect(mocks.findSourceInWorkspace).not.toHaveBeenCalled()
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled()
    expect(mocks.makeKnowhereClient).not.toHaveBeenCalled()
  })

  it("serves demo chunks for authenticated materialized demo sources", async () => {
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
      id: "00000000-0000-0000-0000-000000000001",
      workspaceId: "workspace_1",
      title: "TSLA-Q4-2025-Update.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      status: "ready",
      failureReason: null,
      knowhereJobId: null,
      knowhereDocumentId: "copied-doc-tsla-q4-2025",
      stagedBlobPathname: null,
      stagedBlobUrl: null,
      originalBlobPathname: null,
      originalBlobUrl: "/api/demo-sources/demo-tsla-q4-2025/original",
      demoKey: "demo-tsla-q4-2025",
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
      updatedAt: new Date("2026-05-10T00:00:00.000Z"),
      deletedAt: null,
    })
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
        pageSize: 100,
        total: 70,
        totalPages: 1,
      },
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000001/chunks?page=1&pageSize=100",
      ),
      { params: Promise.resolve({ sourceId: "00000000-0000-0000-0000-000000000001" }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          chunkId: "demo-tsla-q4-2025:chunk_1",
          documentId: "copied-doc-tsla-q4-2025",
          sourceTitle: "TSLA-Q4-2025-Update.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 100,
        total: 70,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.fetchDemoChunkPage).toHaveBeenCalledWith({
      demoSourceId: "demo-tsla-q4-2025",
      page: 1,
      pageSize: 100,
    })
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled()
    expect(mocks.makeKnowhereClient).not.toHaveBeenCalled()
  })

  it("logs the demo chunk load failure before returning 404", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      mocks.getCurrentUser.mockResolvedValue({
        id: "knowhere-api-key-dev-user",
        email: null,
        name: "Knowhere API Key Development",
      })
      mocks.ensureWorkspace.mockResolvedValue({
        id: "workspace_1",
        userId: "knowhere-api-key-dev-user",
        namespace: "notebook-workspace_1",
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
      })
      mocks.findSourceInWorkspace.mockResolvedValue(null)
      mocks.fetchDemoChunkPage.mockRejectedValue(
        new Error("Knowhere demo API failed: status=404"),
      )

      const response = await GET(
        new NextRequest(
          "http://localhost:3001/api/sources/demo-tsla-q4-2025/chunks?page=1&pageSize=100",
        ),
        { params: Promise.resolve({ sourceId: "demo-tsla-q4-2025" }) },
      )

      expect(response.status).toBe(404)
      const line = String(warnSpy.mock.calls[0]?.[0] ?? "")
      const log = JSON.parse(line) as {
        readonly msg?: unknown
        readonly sourceId?: unknown
        readonly page?: unknown
        readonly pageSize?: unknown
        readonly shouldLoadAll?: unknown
        readonly error?: unknown
      }
      expect(log).toMatchObject({
        msg: "sources: demo chunk load failed",
        sourceId: "demo-tsla-q4-2025",
        page: 1,
        pageSize: 100,
        shouldLoadAll: false,
        error: "Knowhere demo API failed: status=404",
      })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("loads authenticated workspace chunks from parsed storage without durable hardening", async () => {
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
          position: 1,
          chunkId: "parser_1",
          chunkType: "image",
          content: "Workspace chunk",
          readableContent: "Workspace chunk",
          sectionPath: "Summary",
          sourceChunkPath: "Summary",
          filePath: "images/chart.png",
          assetUrl:
            "https://fake.public.blob.vercel-storage.com/images/chart.png",
          metadata: {},
        },
      ],
      page: 1,
      pageSize: 1,
      totalChunks: 1,
      totalPages: 1,
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/chunks?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          parserChunkId: "parser_1",
          documentId: "doc_1",
          assetUrl:
            "https://fake.public.blob.vercel-storage.com/images/chart.png",
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
    expect(mocks.readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "job_1",
      page: 1,
      pageSize: 1,
    })
    expect(mocks.listChunks).not.toHaveBeenCalled()
  })

  it("falls back to raw Knowhere asset URLs for workspace chunk display when storage misses", async () => {
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
        resultDirectoryPath: "remote:doc_1",
      },
      chunks: [
        {
          position: 1,
          chunkId: "parser_1",
          chunkType: "image",
          content: "Workspace chunk",
          readableContent: "Workspace chunk",
          sectionPath: "Summary",
          sourceChunkPath: "Summary",
          filePath: "images/chart.png",
          metadata: {},
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
          id: "document_chunk_1",
          chunkId: "parser_1",
          chunkType: "image",
          content: "Workspace chunk",
          sectionId: null,
          sectionPath: "Summary",
          sourceChunkPath: "Summary",
          filePath: "images/chart.png",
          sortOrder: 0,
          metadata: {},
          assetUrl: "https://knowhere.example/assets/chart.png",
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
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/chunks?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          parserChunkId: "parser_1",
          documentId: "doc_1",
          assetUrl: "https://knowhere.example/assets/chart.png",
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
    expect(mocks.readChunks).toHaveBeenCalledWith({
      documentId: "doc_1",
      revisionKey: "job_1",
      page: 1,
      pageSize: 1,
    })
    expect(mocks.listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 1,
      includeAssetUrls: true,
    })
  })

  it("returns processing when a workspace source is not ready", async () => {
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
        knowhereJobId: "job_1",
        knowhereDocumentId: "doc_1",
      }),
    )

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/chunks?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      chunks: [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 0,
        totalPages: 0,
      },
      message: "Source is still being prepared.",
    })
    expect(response.status).toBe(202)
    expect(mocks.readChunks).not.toHaveBeenCalled()
  })

  it("marks workspace chunks unavailable when the parsed document is missing remotely", async () => {
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
        knowhereJobId: "job_1",
        knowhereDocumentId: "doc_missing",
      }),
    )
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.readChunks.mockRejectedValue(notFoundError)

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/00000000-0000-0000-0000-000000000002/chunks?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "00000000-0000-0000-0000-000000000002",
        }),
      },
    )

    await expect(response.json()).resolves.toEqual({
      chunks: [],
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

  it("materializes a remote source id and reads chunks through the SDK", async () => {
    const knowhereClient = {
      documents: {
        list: vi.fn(async () => ({
          documents: [
            {
              documentId: "doc_remote",
              namespace: "default",
              status: "active",
              currentJobResultId: "job_result_1",
              sourceFileName: "remote.pdf",
              documentMetadata: {
                mimeType: "application/pdf",
              },
            },
          ],
        })),
        listChunks: vi.fn(),
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
    mocks.fetchDemoChunkPage.mockRejectedValue(new Error("not a demo"))
    mocks.ensureApiKeyForWorkspace.mockResolvedValue("jwt_123")
    mocks.makeKnowhereClient.mockReturnValue(knowhereClient)
    mocks.localizeRemoteDocument.mockResolvedValue(
      makeReadySource({
        id: "00000000-0000-0000-0000-000000000009",
        title: "remote.pdf",
        knowhereJobId: "job_result_1",
        knowhereDocumentId: "doc_remote",
      }),
    )
    mocks.readChunks.mockResolvedValue({
      document: {
        localDocumentId: "doc_remote",
        resultDirectoryPath: "parsed-storage:doc_remote",
      },
      chunks: [
        {
          position: 1,
          chunkId: "parser_remote",
          chunkType: "page",
          content: "Remote chunk",
          readableContent: "Remote chunk",
          sectionPath: "Summary",
          sourceChunkPath: "Summary",
          filePath: "pages/page-1.png",
          assetUrl:
            "https://fake.public.blob.vercel-storage.com/pages/page-1.png",
          metadata: {},
        },
      ],
      page: 1,
      pageSize: 1,
      totalChunks: 1,
      totalPages: 1,
    })

    const response = await GET(
      new NextRequest(
        "http://localhost:3001/api/sources/knowhere-doc:default:doc_remote/chunks?page=1&pageSize=1",
      ),
      {
        params: Promise.resolve({
          sourceId: "knowhere-doc:default:doc_remote",
        }),
      },
    )

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          parserChunkId: "parser_remote",
          documentId: "doc_remote",
          assetUrl:
            "https://fake.public.blob.vercel-storage.com/pages/page-1.png",
          sourceTitle: "remote.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.findSourceInWorkspace).not.toHaveBeenCalled()
    expect(mocks.ensureApiKeyForWorkspace).toHaveBeenCalledWith(
      "workspace_1",
      "session=abc",
    )
    expect(mocks.localizeRemoteDocument).toHaveBeenCalledWith("workspace_1", {
      documentId: "doc_remote",
      namespace: "default",
      status: "ready",
      title: "remote.pdf",
      mimeType: "application/pdf",
      sizeBytes: undefined,
      revisionKey: "job_result_1",
    })
    expect(mocks.readChunks).toHaveBeenCalledWith({
      documentId: "doc_remote",
      revisionKey: "job_result_1",
      page: 1,
      pageSize: 1,
    })
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
