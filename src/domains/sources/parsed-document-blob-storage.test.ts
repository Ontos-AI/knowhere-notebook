import { describe, expect, it } from "vitest"
import type {
  KnowhereParsedSnapshotChunkPage,
  KnowhereParsedSnapshotManifest,
  ParsedDocumentSyncProgress,
} from "@ontos-ai/knowhere-sdk"

import {
  BlobParsedDocumentStorage,
  type ParsedDocumentBlobStore,
} from "./parsed-document-blob-storage"

type StoredBlob = {
  readonly body: string | Buffer
  readonly contentType: string
}

function createFakeBlobStore(): {
  readonly store: ParsedDocumentBlobStore
  readonly objects: Map<string, StoredBlob>
} {
  const objects = new Map<string, StoredBlob>()
  const toUrl = (pathname: string) =>
    `https://fake.public.blob.vercel-storage.com/${pathname}`

  const store: ParsedDocumentBlobStore = {
    get: async (pathname) => {
      const object = objects.get(pathname)
      if (!object) return null
      const body =
        typeof object.body === "string"
          ? object.body
          : new Uint8Array(object.body)
      return {
        statusCode: 200,
        stream: new Response(body).body as ReadableStream<Uint8Array>,
      }
    },
    put: async (pathname, body, options) => {
      objects.set(pathname, { body, contentType: options.contentType })
      return { url: toUrl(pathname), pathname }
    },
    head: async (pathname) => {
      const object = objects.get(pathname)
      return object ? { url: toUrl(pathname) } : null
    },
    del: async (pathname) => {
      objects.delete(pathname)
    },
  }

  return { store, objects }
}

const documentId = "doc_123"
const revisionKey = "job_result_1"

const manifest: KnowhereParsedSnapshotManifest = {
  version: 1,
  kind: "knowhere-parsed-result-snapshot",
  jobId: "job_1",
  revisionKey,
  documentId,
  sourceFileName: "example.pdf",
  totalChunks: 2,
  chunkPageSize: 200,
  chunkPages: [{ page: 1, pageSize: 200, chunkCount: 2, key: "chunks/page-1.json" }],
  assetUrlsByFilePath: {},
  createdAt: "2026-07-04T00:00:00.000Z",
}

const chunkPage: KnowhereParsedSnapshotChunkPage = {
  version: 1,
  jobId: "job_1",
  revisionKey,
  documentId,
  sourceFileName: "example.pdf",
  page: 1,
  pageSize: 200,
  total: 2,
  totalPages: 1,
  chunks: [
    {
      id: "c1",
      chunkId: "c1",
      chunkType: "text",
      content: "hello",
      sourceChunkPath: "example.pdf",
      sortOrder: 0,
      metadata: {},
    },
  ],
}

describe("BlobParsedDocumentStorage", () => {
  it("round-trips a manifest keyed by workspace/document/revision", async () => {
    const { store, objects } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await storage.writeManifest({ documentId, revisionKey, manifest })

    expect([...objects.keys()]).toContain(
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/manifest/current.json",
    )
    const read = await storage.readManifest({ documentId, revisionKey })
    expect(read).toEqual(manifest)
  })

  it("round-trips a chunk page", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await storage.writeChunkPage({ documentId, revisionKey, page: chunkPage })
    const read = await storage.readChunkPage({ documentId, revisionKey, page: 1 })
    expect(read).toEqual(chunkPage)
  })

  it("round-trips sync progress", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })
    const progress: ParsedDocumentSyncProgress = {
      documentId,
      revisionKey,
      nextChunkPage: 3,
      nextAssetIndex: 0,
      status: "running",
      updatedAt: "2026-07-04T00:00:00.000Z",
    }

    await storage.writeSyncProgress(progress)
    const read = await storage.readSyncProgress({ documentId, revisionKey })
    expect(read).toEqual(progress)
  })

  it("writes an asset and resolves a durable URL", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    const written = await storage.writeAsset({
      documentId,
      revisionKey,
      sourcePath: "images/fig-1.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    })
    expect(written.url).toContain(
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/assets/images/fig-1.png",
    )

    const url = await storage.getAssetUrl({
      documentId,
      revisionKey,
      sourcePath: "images/fig-1.png",
    })
    expect(url).toBe(written.url)
  })

  it("returns null for a missing manifest, chunk page, progress, and asset", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    expect(await storage.readManifest({ documentId, revisionKey })).toBeNull()
    expect(
      await storage.readChunkPage({ documentId, revisionKey, page: 9 }),
    ).toBeNull()
    expect(await storage.readSyncProgress({ documentId, revisionKey })).toBeNull()
    expect(
      await storage.getAssetUrl({ documentId, revisionKey, sourcePath: "x.png" }),
    ).toBeNull()
  })

  it("isolates artifacts by revision key so a stale revision does not read", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await storage.writeManifest({ documentId, revisionKey, manifest })
    const staleRead = await storage.readManifest({
      documentId,
      revisionKey: "job_result_2",
    })
    expect(staleRead).toBeNull()
  })

  it("rejects traversal in the document id, revision key, and asset path", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await expect(
      storage.readManifest({ documentId: "../escape", revisionKey }),
    ).rejects.toThrow(/Invalid parsed storage segment/)
    await expect(
      storage.readManifest({ documentId, revisionKey: "a/b" }),
    ).rejects.toThrow(/Invalid parsed storage segment/)
    await expect(
      storage.getAssetUrl({
        documentId,
        revisionKey,
        sourcePath: "../../etc/passwd",
      }),
    ).rejects.toThrow(/Invalid parsed storage path/)
  })
})
