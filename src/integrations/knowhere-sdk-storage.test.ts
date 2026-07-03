import { BlobNotFoundError, type HeadBlobResult } from "@vercel/blob"
import { describe, expect, it } from "vitest"

import {
  createVercelBlobKnowhereSdkStorage,
  type VercelBlobStore,
} from "./knowhere-sdk-storage"

type StoredBlob = {
  readonly pathname: string
  readonly body: Uint8Array
  readonly contentType?: string
  readonly url: string
}

class MemoryVercelBlobStore implements VercelBlobStore {
  readonly objects = new Map<string, StoredBlob>()

  async put(
    pathname: string,
    body: Parameters<VercelBlobStore["put"]>[1],
    options: Parameters<VercelBlobStore["put"]>[2],
  ): Promise<{ readonly pathname: string; readonly url: string }> {
    const url = `https://blob.example/${pathname}`
    this.objects.set(pathname, {
      pathname,
      body: await readBody(body),
      contentType: options.contentType,
      url,
    })
    return { pathname, url }
  }

  async head(pathname: string): Promise<HeadBlobResult> {
    const object = this.objects.get(pathname)
    if (!object) throw new BlobNotFoundError()

    return {
      size: object.body.byteLength,
      uploadedAt: new Date("2026-07-03T00:00:00.000Z"),
      pathname,
      contentType: object.contentType ?? "application/octet-stream",
      contentDisposition: "",
      url: object.url,
      downloadUrl: `${object.url}?download=1`,
      cacheControl: "",
      etag: `etag:${pathname}`,
    }
  }

  async get(
    pathname: string,
  ): Promise<Awaited<ReturnType<VercelBlobStore["get"]>>> {
    const object = this.objects.get(pathname)
    if (!object) return null

    return {
      statusCode: 200,
      stream: toReadableStream(object.body),
      headers: new Headers(),
      blob: {
        url: object.url,
        downloadUrl: `${object.url}?download=1`,
        pathname,
        contentDisposition: "",
        cacheControl: "",
        uploadedAt: new Date("2026-07-03T00:00:00.000Z"),
        etag: `etag:${pathname}`,
        contentType: object.contentType ?? "application/octet-stream",
        size: object.body.byteLength,
      },
    }
  }

  async list(input: {
    readonly prefix: string
    readonly limit: number
    readonly cursor?: string
  }): Promise<Awaited<ReturnType<VercelBlobStore["list"]>>> {
    const start = input.cursor ? Number(input.cursor) : 0
    const matches = [...this.objects.values()]
      .filter((object) => object.pathname.startsWith(input.prefix))
      .sort((left, right) => left.pathname.localeCompare(right.pathname))
    const page = matches.slice(start, start + input.limit)
    const nextIndex = start + page.length
    const hasMore = nextIndex < matches.length

    return {
      blobs: page.map((object) => ({
        url: object.url,
        downloadUrl: `${object.url}?download=1`,
        pathname: object.pathname,
        size: object.body.byteLength,
        uploadedAt: new Date("2026-07-03T00:00:00.000Z"),
        etag: `etag:${object.pathname}`,
      })),
      hasMore,
      ...(hasMore ? { cursor: String(nextIndex) } : {}),
    }
  }

  async del(pathname: string | readonly string[]): Promise<void> {
    const pathnames = typeof pathname === "string" ? [pathname] : [...pathname]
    for (const item of pathnames) {
      this.objects.delete(item)
    }
  }
}

describe("createVercelBlobKnowhereSdkStorage", () => {
  it("rejects unsafe storage keys", async () => {
    const storage = createVercelBlobKnowhereSdkStorage(
      new MemoryVercelBlobStore(),
    )

    for (const key of [
      "",
      "/absolute/path.png",
      "nested//empty.png",
      "nested/../escape.png",
      "nested/./dot.png",
      "nested\\windows.png",
      "nested/\0/null.png",
    ]) {
      await expect(
        storage.writeObject({
          key,
          body: new Uint8Array([1]),
          contentType: "image/png",
        }),
      ).rejects.toThrow("Invalid Knowhere SDK storage key")
    }
  })

  it("writes objects with metadata sidecars and returns blob URLs", async () => {
    const blobStore = new MemoryVercelBlobStore()
    const storage = createVercelBlobKnowhereSdkStorage(blobStore)

    const result = await storage.writeObject({
      key: "page-citation-assets/documents/doc_1/page.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      metadata: {
        width: "1200",
        height: "1600",
        mimeType: "image/png",
      },
    })

    expect(result).toEqual({
      key: "page-citation-assets/documents/doc_1/page.png",
      url: "https://blob.example/page-citation-assets/documents/doc_1/page.png",
    })
    expect(
      blobStore.objects.has("page-citation-assets/documents/doc_1/page.png"),
    ).toBe(true)
    const metadataSidecar = blobStore.objects.get(
      "page-citation-assets/documents/doc_1/page.png.metadata.json",
    )
    expect(metadataSidecar).toBeDefined()
    if (!metadataSidecar) throw new Error("Expected metadata sidecar.")

    expect(JSON.parse(decodeBody(metadataSidecar.body))).toEqual({
      metadata: {
        width: "1200",
        height: "1600",
        mimeType: "image/png",
      },
    })
  })

  it("combines blob head data with sidecar metadata", async () => {
    const blobStore = new MemoryVercelBlobStore()
    const storage = createVercelBlobKnowhereSdkStorage(blobStore)

    await storage.writeObject({
      key: "page-citation-assets/documents/doc_1/page.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      metadata: {
        width: "1200",
        height: "1600",
      },
    })

    await expect(
      storage.headObject("page-citation-assets/documents/doc_1/page.png"),
    ).resolves.toEqual({
      key: "page-citation-assets/documents/doc_1/page.png",
      contentType: "image/png",
      contentLength: 3,
      metadata: {
        width: "1200",
        height: "1600",
      },
    })
  })

  it("reads objects, resolves URLs, deletes objects, and deletes prefixes", async () => {
    const blobStore = new MemoryVercelBlobStore()
    const storage = createVercelBlobKnowhereSdkStorage(blobStore)

    await storage.writeObject({
      key: "prefix/one.png",
      body: new Uint8Array([1]),
      contentType: "image/png",
    })
    await storage.writeObject({
      key: "prefix/two.png",
      body: new Uint8Array([2]),
      contentType: "image/png",
    })
    await storage.writeObject({
      key: "prefix-sibling/two.png",
      body: new Uint8Array([4]),
      contentType: "image/png",
    })
    await storage.writeObject({
      key: "other/three.png",
      body: new Uint8Array([3]),
      contentType: "image/png",
    })

    const readObject = storage.readObject
    const getObjectUrl = storage.getObjectUrl
    const deleteObject = storage.deleteObject
    const deletePrefix = storage.deletePrefix
    expect(readObject).toBeDefined()
    expect(getObjectUrl).toBeDefined()
    expect(deleteObject).toBeDefined()
    expect(deletePrefix).toBeDefined()
    if (!readObject || !getObjectUrl || !deleteObject || !deletePrefix) {
      throw new Error("Expected full storage adapter methods.")
    }

    await expect(storage.readObject?.("prefix/one.png")).resolves.toMatchObject({
      body: new Uint8Array([1]),
      contentType: "image/png",
    })
    await expect(storage.getObjectUrl?.("prefix/one.png")).resolves.toBe(
      "https://blob.example/prefix/one.png",
    )

    await storage.deleteObject?.("prefix/one.png")
    expect(blobStore.objects.has("prefix/one.png")).toBe(false)
    expect(blobStore.objects.has("prefix/one.png.metadata.json")).toBe(false)

    await storage.deletePrefix?.("prefix")
    expect([...blobStore.objects.keys()].sort()).toEqual([
      "other/three.png",
      "other/three.png.metadata.json",
      "prefix-sibling/two.png",
      "prefix-sibling/two.png.metadata.json",
    ])
  })

  it("accepts trailing slashes when deleting prefixes", async () => {
    const blobStore = new MemoryVercelBlobStore()
    const storage = createVercelBlobKnowhereSdkStorage(blobStore)

    await storage.writeObject({
      key: "prefix/one.png",
      body: new Uint8Array([1]),
      contentType: "image/png",
    })

    await storage.deletePrefix?.("prefix/")

    expect(blobStore.objects.size).toBe(0)
  })
})

async function readBody(
  body: Parameters<VercelBlobStore["put"]>[1],
): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return new Uint8Array(body)
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
  return readStream(body)
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
      totalLength += result.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function toReadableStream(body: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body)
      controller.close()
    },
  })
}

function decodeBody(body: Uint8Array): string {
  return new TextDecoder().decode(body)
}
