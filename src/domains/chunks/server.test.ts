import { describe, expect, it, vi, type Mock } from "vitest"
import { Effect } from "effect"
import type { DocumentChunk } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import {
  loadChunkPageForSource,
  loadChunksForSource,
} from "./server"

describe("server chunk cache", () => {
  it("loads ready source chunks from the parsed Blob snapshot without calling Knowhere listChunks", async () => {
    const listChunks = vi.fn(async () => ({
      documentId: "doc_1",
      chunks: [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 0,
        totalPages: 0,
      },
    }))
    const snapshotStore = createSnapshotStore({
      "workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json":
        JSON.stringify({
          version: 1,
          kind: "knowhere-parsed-result-snapshot",
          jobId: "job_1",
          documentId: "doc_1",
          sourceFileName: "notes.pdf",
          totalChunks: 1,
          chunkPageSize: 1,
          chunkPages: [
            {
              page: 1,
              pageSize: 1,
              chunkCount: 1,
              key: "workspaces/workspace_1/sources/source_1/parsed-result/chunks/page-1.json",
            },
          ],
          assetUrlsByFilePath: {
            "images/chart.png": "https://blob.example/images/chart.png",
          },
          createdAt: "2026-07-03T00:00:00.000Z",
        }),
      "workspaces/workspace_1/sources/source_1/parsed-result/chunks/page-1.json":
        JSON.stringify({
          version: 1,
          jobId: "job_1",
          documentId: "doc_1",
          sourceFileName: "notes.pdf",
          page: 1,
          pageSize: 1,
          total: 1,
          totalPages: 1,
          chunks: [
            {
              id: "chunk_image_1",
              chunkId: "parser_image_1",
              chunkType: "image",
              content: "Chart summary",
              sectionPath: "Revenue",
              sourceChunkPath: "notes.pdf/Revenue",
              filePath: "images/chart.png",
              sortOrder: 1,
              metadata: { summary: "Chart summary" },
            },
          ],
        }),
    })

    const page = await Effect.runPromise(
      loadChunkPageForSource(
        makeSource({ status: "ready", knowhereJobId: "job_1" }),
        { documents: { listChunks } },
        { page: 1, pageSize: 1 },
        {
          snapshot: {
            resultBlobUrl:
              "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
            snapshotManifestUrl:
              "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
            snapshotManifestKey:
              "workspaces/workspace_1/sources/source_1/parsed-result/manifest/current.json",
            assetUrlsByFilePath: {},
          },
          snapshotStore,
          workspaceId: "workspace_1",
        },
      ),
    )

    expect(listChunks).not.toHaveBeenCalled()
    expect(page).toEqual({
      chunks: [
        expect.objectContaining({
          chunkId: "chunk_image_1",
          parserChunkId: "parser_image_1",
          type: "image",
          assetUrl: "https://blob.example/images/chart.png",
          sourceTitle: "notes.pdf",
        }),
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    })
  })

  it("returns upstream chunks on a visible cache miss and warms mirrored assets in the background", async () => {
    const warmTasks: Array<() => Promise<void>> = []
    const cacheStore = createCacheStore()
    const listChunks = vi.fn(async () => ({
      documentId: "doc_1",
      jobResultId: "revision_1",
      chunks: [
        makeDocumentChunk({
          id: "image_1",
          chunkId: "parser_image_1",
          chunkType: "image",
          filePath: "images/image-1.png",
          assetUrl: "https://knowhere.example/assets/image-1.png",
        }),
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    }))
    const fetchAsset = vi.fn(async () =>
      new Response("image-body", {
        headers: { "content-type": "image/png" },
      }),
    )

    const page = await Effect.runPromise(
      loadChunkPageForSource(
        makeSource({ knowhereJobId: "revision_1" }),
        { documents: { listChunks } },
        { page: 1, pageSize: 1 },
        {
          cacheStore,
          fetchAsset,
          scheduleWarm: (task) => warmTasks.push(task),
          workspaceId: "workspace_1",
        },
      ),
    )

    expect(page.chunks[0]?.assetUrl).toBe(
      "https://knowhere.example/assets/image-1.png",
    )
    expect(cacheStore.putMock).not.toHaveBeenCalled()
    expect(warmTasks).toHaveLength(1)

    await warmTasks[0]?.()

    expect(fetchAsset).toHaveBeenCalledWith(
      "https://knowhere.example/assets/image-1.png",
    )
    expect(cacheStore.putMock).toHaveBeenCalledWith(
      expect.stringContaining("/chunk-assets/revision_1/"),
      Buffer.from("image-body"),
      expect.objectContaining({ contentType: "image/png" }),
    )
    const cachedPagePut = cacheStore.putMock.mock.calls.find(
      ([pathname]) =>
        typeof pathname === "string" && pathname.endsWith(".json"),
    )
    expect(cachedPagePut).toBeDefined()
    const cachedPage = JSON.parse(String(cachedPagePut?.[1])) as {
      readonly chunks: readonly { readonly assetUrl?: string }[]
    }
    expect(cachedPage.chunks[0]?.assetUrl).toContain(
      "https://blob.example/workspaces/workspace_1/sources/source_1/chunk-assets/revision_1/",
    )
  })

  it("returns a cached visible page after verifying the current Knowhere revision", async () => {
    const cachedPage = {
      chunks: [
        {
          chunkId: "image_1",
          documentId: "doc_1",
          type: "image",
          content: "",
          assetUrl: "https://blob.example/image-1.png",
          sourceTitle: "notes.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    }
    const listChunks = vi.fn(async () => ({
      documentId: "doc_1",
      jobResultId: "revision_1",
      chunks: [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    }))
    const cacheStore = createCacheStore({
      get: vi.fn(async () => ({
        statusCode: 200,
        stream: createTextStream(JSON.stringify(cachedPage)),
      })),
    })

    const page = await Effect.runPromise(
      loadChunkPageForSource(
        makeSource({ knowhereJobId: "revision_1" }),
        { documents: { listChunks } },
        { page: 1, pageSize: 1 },
        {
          cacheStore,
          workspaceId: "workspace_1",
        },
      ),
    )

    expect(page).toEqual(cachedPage)
    expect(listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 1,
      includeAssetUrls: false,
    })
    expect(cacheStore.getMock).toHaveBeenCalledWith(
      expect.stringContaining("/revision_1/visible/page-1-size-1.json"),
      { access: "public" },
    )
  })

  it("ignores old cached pages when Knowhere reports a new job id", async () => {
    const warmTasks: Array<() => Promise<void>> = []
    const staleCachedPage = {
      chunks: [
        {
          chunkId: "stale_1",
          documentId: "doc_1",
          type: "text",
          content: "Old chunk",
          sourceTitle: "notes.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    }
    const cacheStore = createCacheStore({
      get: vi.fn(async (pathname: string) =>
        pathname.includes("/job_old/")
          ? {
              statusCode: 200,
              stream: createTextStream(JSON.stringify(staleCachedPage)),
            }
          : null,
      ),
    })
    const listChunks = vi.fn(async (
      _documentId: string,
      params: { readonly includeAssetUrls: boolean },
    ) => ({
      documentId: "doc_1",
      jobId: "job_new",
      chunks: params.includeAssetUrls
        ? [
            makeDocumentChunk({
              id: "text_new",
              chunkId: "parser_text_new",
              content: "New chunk",
            }),
          ]
        : [],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    }))
    const onRevisionKey = vi.fn(async () => undefined)

    const page = await Effect.runPromise(
      loadChunkPageForSource(
        makeSource({ knowhereJobId: "job_old" }),
        { documents: { listChunks } },
        { page: 1, pageSize: 1 },
        {
          cacheStore,
          onRevisionKey,
          scheduleWarm: (task) => warmTasks.push(task),
          workspaceId: "workspace_1",
        },
      ),
    )

    expect(page.chunks[0]?.content).toBe("New chunk")
    expect(cacheStore.getMock).toHaveBeenCalledWith(
      expect.stringContaining("/job_new/visible/page-1-size-1.json"),
      { access: "public" },
    )
    expect(cacheStore.getMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/job_old/visible/page-1-size-1.json"),
      expect.anything(),
    )
    expect(onRevisionKey).toHaveBeenCalledWith("job_new")
    expect(warmTasks).toHaveLength(1)
  })

  it("uses structure-only chunk loading for full-tree requests", async () => {
    const warmTasks: Array<() => Promise<void>> = []
    const cacheStore = createCacheStore()
    const listChunks = vi.fn(async () => ({
      documentId: "doc_1",
      jobResultId: "revision_1",
      chunks: [
        makeDocumentChunk({
          id: "text_1",
          chunkId: "parser_text_1",
          content: "A text chunk",
        }),
      ],
      pagination: {
        page: 1,
        pageSize: 200,
        total: 1,
        totalPages: 1,
      },
    }))
    const fetchAsset = vi.fn()

    const chunks = await Effect.runPromise(
      loadChunksForSource(
        makeSource({ knowhereJobId: "revision_1" }),
        { documents: { listChunks } },
        {
          cacheStore,
          fetchAsset,
          scheduleWarm: (task) => warmTasks.push(task),
          workspaceId: "workspace_1",
        },
      ),
    )

    expect(chunks).toMatchObject([{ chunkId: "text_1" }])
    expect(listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 200,
      includeAssetUrls: false,
    })
    expect(fetchAsset).not.toHaveBeenCalled()
    expect(warmTasks).toHaveLength(1)
    await warmTasks[0]?.()
    expect(cacheStore.putMock).toHaveBeenCalledWith(
      expect.stringContaining("/structure/page-1-size-200.json"),
      expect.any(String),
      expect.objectContaining({ contentType: "application/json; charset=utf-8" }),
    )
  })

  it("caches media chunks without previews when Knowhere has no upstream asset URL", async () => {
    const warmTasks: Array<() => Promise<void>> = []
    const cacheStore = createCacheStore()
    const listChunks = vi.fn(async () => ({
      documentId: "doc_1",
      jobResultId: "revision_1",
      chunks: [
        makeDocumentChunk({
          id: "image_1",
          chunkId: "parser_image_1",
          chunkType: "image",
          filePath: "images/image-1.png",
          assetUrl: null,
        }),
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    }))
    const fetchAsset = vi.fn()

    const page = await Effect.runPromise(
      loadChunkPageForSource(
        makeSource({ knowhereJobId: "revision_1" }),
        { documents: { listChunks } },
        { page: 1, pageSize: 1 },
        {
          cacheStore,
          fetchAsset,
          scheduleWarm: (task) => warmTasks.push(task),
          workspaceId: "workspace_1",
        },
      ),
    )

    expect(page.chunks[0]?.assetUrl).toBeUndefined()
    await warmTasks[0]?.()
    expect(fetchAsset).not.toHaveBeenCalled()
    const cachedPagePut = cacheStore.putMock.mock.calls.find(
      ([pathname]) =>
        typeof pathname === "string" && pathname.endsWith(".json"),
    )
    const cachedPage = JSON.parse(String(cachedPagePut?.[1])) as {
      readonly chunks: readonly { readonly assetUrl?: string }[]
    }
    expect(cachedPage.chunks[0]?.assetUrl).toBeUndefined()
  })
})

type TestCacheGetResult =
  | {
      readonly statusCode: 200
      readonly stream: ReadableStream<Uint8Array>
    }
  | {
      readonly statusCode: 304
      readonly stream: null
    }

type TestCachePutOptions = {
  readonly access: "public"
  readonly allowOverwrite: boolean
  readonly contentType: string
  readonly multipart?: boolean
}

type TestCacheStore = {
  readonly get: (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<TestCacheGetResult | null>
  readonly put: (
    pathname: string,
    body: string | Buffer,
    options: TestCachePutOptions,
  ) => Promise<{ readonly url: string }>
  readonly getMock: TestCacheGetMock
  readonly putMock: TestCachePutMock
}

type TestSnapshotStore = {
  readonly get: (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<TestCacheGetResult | null>
}

type TestCacheGetMock = Mock<
  (
    pathname: string,
    options: { readonly access: "public" },
  ) => Promise<TestCacheGetResult | null>
>

type TestCachePutMock = Mock<
  (
    pathname: string,
    body: string | Buffer,
    options: TestCachePutOptions,
  ) => Promise<{ readonly url: string }>
>

function createCacheStore(overrides: Partial<{
  readonly get: TestCacheGetMock
  readonly put: TestCachePutMock
}> = {}): TestCacheStore {
  const getMock =
    overrides.get ??
    vi.fn(async () => null)
  const putMock =
    overrides.put ??
    vi.fn(async (pathname: string) => ({
      url: `https://blob.example/${pathname}`,
    }))

  return {
    get: (pathname, options) => getMock(pathname, options),
    put: (pathname, body, options) => putMock(pathname, body, options),
    getMock,
    putMock,
  }
}

function createSnapshotStore(
  entriesByPathname: Readonly<Record<string, string>>,
): TestSnapshotStore {
  return {
    get: vi.fn(async (pathname: string) => {
      const entry = entriesByPathname[pathname]
      if (!entry) return null
      return {
        statusCode: 200 as const,
        stream: createTextStream(entry),
      }
    }),
  }
}

function makeDocumentChunk(
  overrides: Partial<DocumentChunk> = {},
): DocumentChunk {
  return {
    id: "document_chunk_1",
    chunkId: "parser_chunk_1",
    chunkType: "text",
    content: "Chunk content",
    sectionId: null,
    sectionPath: null,
    sourceChunkPath: null,
    filePath: null,
    sortOrder: 1,
    metadata: {},
    assetUrl: null,
    ...overrides,
  }
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    status: "ready",
    failureReason: null,
    knowhereJobId: "revision_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}

function createTextStream(text: string): ReadableStream<Uint8Array> {
  const stream = new Response(text).body
  if (!stream) throw new Error("Response body stream was not created.")
  return stream
}
