import { describe, expect, it } from "vitest"
import type { ParsedDocumentSyncProgress } from "@ontos-ai/knowhere-sdk"

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
        url: toUrl(pathname),
        contentType: object.contentType,
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

const manifest = {
  version: "2.0",
  jobId: "job_1",
  sourceFileName: "example.pdf",
  statistics: {
    totalChunks: 2,
    textChunks: 1,
    imageChunks: 1,
    tableChunks: 0,
    pageChunks: 0,
  },
} satisfies Record<string, unknown>

const chunks = {
  chunks: [
    {
      chunk_id: "c1",
      type: "text",
      content: "hello",
      path: "example.pdf",
      metadata: {},
    },
  ],
} satisfies Record<string, unknown>

describe("BlobParsedDocumentStorage", () => {
  it("round-trips a manifest at the result-relative manifest path", async () => {
    const { store, objects } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await storage.writeObject({
      documentId,
      revisionKey,
      path: "manifest.json",
      body: Buffer.from(JSON.stringify(manifest), "utf8"),
      contentType: "application/json; charset=utf-8",
    })

    expect([...objects.keys()]).toContain(
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/manifest.json",
    )
    const read = await storage.readObject({
      documentId,
      revisionKey,
      path: "manifest.json",
    })
    expect(read ? Buffer.from(read.body).toString("utf8") : null).toBe(
      JSON.stringify(manifest),
    )
  })

  it("round-trips chunks at the result-relative chunks path", async () => {
    const { store, objects } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await storage.writeObject({
      documentId,
      revisionKey,
      path: "chunks.json",
      body: Buffer.from(JSON.stringify(chunks), "utf8"),
      contentType: "application/json; charset=utf-8",
    })
    expect([...objects.keys()]).toContain(
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/chunks.json",
    )
    const read = await storage.readObject({
      documentId,
      revisionKey,
      path: "chunks.json",
    })
    expect(read ? Buffer.from(read.body).toString("utf8") : null).toBe(
      JSON.stringify(chunks),
    )
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
      status: "running",
      updatedAt: "2026-07-04T00:00:00.000Z",
    }

    await storage.writeSyncProgress(progress)
    const read = await storage.readSyncProgress({ documentId, revisionKey })
    expect(read).toEqual(progress)
  })

  it("writes an asset without adding a Notebook logical assets prefix", async () => {
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
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/images/fig-1.png",
    )

    const url = await storage.getAssetUrl({
      documentId,
      revisionKey,
      sourcePath: "images/fig-1.png",
    })
    expect(url).toBe(written.url)
  })

  it("round-trips arbitrary result-relative objects", async () => {
    const { store, objects } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    await storage.writeObject({
      documentId,
      revisionKey,
      path: "page_citation_assets/page-1.png",
      body: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
    })
    await storage.writeObject({
      documentId,
      revisionKey,
      path: "images/fig-1.png",
      body: new Uint8Array([7, 8, 9]),
      contentType: "image/png",
    })

    expect([...objects.keys()]).toContain(
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/page_citation_assets/page-1.png",
    )
    expect([...objects.keys()]).toContain(
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/images/fig-1.png",
    )
    const read = await storage.readObject({
      documentId,
      revisionKey,
      path: "page_citation_assets/page-1.png",
    })
    expect(read?.body).toEqual(Buffer.from([4, 5, 6]))
    expect(read?.contentType).toBe("image/png")
  })

  it("resolves legacy asset-prefixed URLs without writing new assets there", async () => {
    const { store, objects } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })
    const legacyKey =
      "workspaces/ws_1/parsed-documents/doc_123/job_result_1/assets/images/fig-1.png"
    objects.set(legacyKey, {
      body: Buffer.from([1]),
      contentType: "image/png",
    })

    const url = await storage.getAssetUrl({
      documentId,
      revisionKey,
      sourcePath: "images/fig-1.png",
    })
    expect(url).toBe(
      "https://fake.public.blob.vercel-storage.com/workspaces/ws_1/parsed-documents/doc_123/job_result_1/assets/images/fig-1.png",
    )
  })

  it("returns null for a missing object, progress, and asset", async () => {
    const { store } = createFakeBlobStore()
    const storage = new BlobParsedDocumentStorage({
      workspaceId: "ws_1",
      blobStore: store,
    })

    expect(
      await storage.readObject({ documentId, revisionKey, path: "manifest.json" }),
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

    await storage.writeObject({
      documentId,
      revisionKey,
      path: "manifest.json",
      body: Buffer.from(JSON.stringify(manifest), "utf8"),
      contentType: "application/json; charset=utf-8",
    })
    const staleRead = await storage.readObject({
      documentId,
      revisionKey: "job_result_2",
      path: "manifest.json",
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
      storage.readObject({
        documentId: "../escape",
        revisionKey,
        path: "manifest.json",
      }),
    ).rejects.toThrow(/Invalid parsed storage segment/)
    await expect(
      storage.readObject({
        documentId,
        revisionKey: "a/b",
        path: "manifest.json",
      }),
    ).rejects.toThrow(/Invalid parsed storage segment/)
    await expect(
      storage.getAssetUrl({
        documentId,
        revisionKey,
        sourcePath: "../../etc/passwd",
      }),
    ).rejects.toThrow(/Invalid parsed storage path/)
    await expect(
      storage.readObject({
        documentId,
        revisionKey,
        path: "images/../escape.png",
      }),
    ).rejects.toThrow(/Invalid parsed storage path/)
  })
})
