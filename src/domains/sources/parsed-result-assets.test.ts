import { describe, expect, it, vi } from "vitest"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import {
  completeResultZipMultipartUpload,
  createResultZipMultipartUploadPlan,
  getResultZipPartRange,
  prepareParsedResultAssetBatch,
  storeParsedResultAssets,
  uploadResultZipPart,
} from "./parsed-result-assets"

describe("storeParsedResultAssets", () => {
  it("stores the result zip and extracted media assets in blob storage", async () => {
    const uploaded: Array<{
      pathname: string
      body: Buffer | string
      contentType: string
    }> = []
    const rawZip = Buffer.from("zip bytes")
    const imageData = Buffer.from("jpg bytes")
    const job = makeJobResult()
    const client = {
      jobs: {
        load: vi.fn().mockResolvedValue({
          rawZip,
          imageChunks: [
            {
              filePath: "images/image-1.jpg",
              data: imageData,
            },
            {
              filePath: "../private.jpg",
              data: Buffer.from("invalid"),
            },
          ],
          tableChunks: [
            {
              filePath: "tables/table-1.html",
              html: "<table><tbody><tr><td>One</td></tr></tbody></table>",
            },
          ],
        }),
      },
    }
    const blobStore = {
      put: vi.fn(
        async (
          pathname: string,
          body: Buffer | string,
          options: { contentType: string },
        ) => {
          uploaded.push({ pathname, body, contentType: options.contentType })
          return { url: `https://blob.example/${pathname}` }
        },
      ),
    }

    const stored = await storeParsedResultAssets({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      job,
      client,
      blobStore,
    })

    expect(client.jobs.load).toHaveBeenCalledWith(job)
    expect(uploaded).toEqual([
      {
        pathname:
          "workspaces/workspace_1/sources/source_1/parsed-result/result.zip",
        body: rawZip,
        contentType: "application/zip",
      },
      {
        pathname:
          "workspaces/workspace_1/sources/source_1/parsed-result/images/image-1.jpg",
        body: imageData,
        contentType: "image/jpeg",
      },
      {
        pathname:
          "workspaces/workspace_1/sources/source_1/parsed-result/tables/table-1.html",
        body: "<table><tbody><tr><td>One</td></tr></tbody></table>",
        contentType: "text/html; charset=utf-8",
      },
    ])
    expect(stored).toEqual({
      resultBlobUrl:
        "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/result.zip",
      assetUrlsByFilePath: {
        "images/image-1.jpg":
          "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/images/image-1.jpg",
        "tables/table-1.html":
          "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/tables/table-1.html",
      },
    })
  })
})

describe("result ZIP multipart mirroring", () => {
  it("uploads expected 8 MB byte ranges and completes with the final Blob URL", async () => {
    const partSizeBytes = 8 * 1024 * 1024
    const sizeBytes = partSizeBytes * 2 + 3
    const fetchResult = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(sizeBytes),
          },
        })
      }

      const range = init?.headers
        ? new Headers(init.headers).get("range")
        : null
      const match = /^bytes=(\d+)-(\d+)$/u.exec(range ?? "")
      if (!match) {
        return new Response("missing range", { status: 400 })
      }

      const startByte = Number.parseInt(match[1] ?? "", 10)
      const endByte = Number.parseInt(match[2] ?? "", 10)
      return new Response(Buffer.alloc(endByte - startByte + 1), {
        status: 206,
      })
    })
    const client = {
      jobs: {
        get: vi.fn(async () => ({
          resultUrl: "https://knowhere.example/result.zip",
        })),
      },
    }
    const blobStore = {
      createMultipartUpload: vi.fn(async () => ({
        key: "blob-key",
        uploadId: "upload-1",
      })),
      uploadPart: vi.fn(
        async (
          _pathname: string,
          _body: Buffer,
          options: { readonly partNumber: number },
        ) => ({
          etag: `etag-${options.partNumber}`,
          partNumber: options.partNumber,
        }),
      ),
      completeMultipartUpload: vi.fn(async () => ({
        url: "https://blob.example/result.zip",
      })),
    }

    const plan = await createResultZipMultipartUploadPlan({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      client,
      blobStore,
      fetchResult,
      partSizeBytes,
    })
    const parts: Array<{ readonly etag: string; readonly partNumber: number }> =
      []
    for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
      parts.push(
        await uploadResultZipPart({
          pathname: plan.pathname,
          key: plan.key,
          uploadId: plan.uploadId,
          partNumber,
          jobId: "job_1",
          client,
          blobStore,
          fetchResult,
          ...getResultZipPartRange(partNumber, partSizeBytes, sizeBytes),
        }),
      )
    }
    const completed = await completeResultZipMultipartUpload({
      pathname: plan.pathname,
      key: plan.key,
      uploadId: plan.uploadId,
      parts,
      blobStore,
    })

    expect(plan).toEqual({
      pathname:
        "workspaces/workspace_1/sources/source_1/parsed-result/result.zip",
      key: "blob-key",
      uploadId: "upload-1",
      sizeBytes,
      partSizeBytes,
      partCount: 3,
    })
    expect(fetchResult).toHaveBeenCalledWith(
      "https://knowhere.example/result.zip",
      expect.objectContaining({
        method: "HEAD",
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchResult).toHaveBeenCalledWith(
      "https://knowhere.example/result.zip",
      expect.objectContaining({
        headers: { Range: `bytes=0-${partSizeBytes - 1}` },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchResult).toHaveBeenCalledWith(
      "https://knowhere.example/result.zip",
      expect.objectContaining({
        headers: {
          Range: `bytes=${partSizeBytes}-${partSizeBytes * 2 - 1}`,
        },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchResult).toHaveBeenCalledWith(
      "https://knowhere.example/result.zip",
      expect.objectContaining({
        headers: {
          Range: `bytes=${partSizeBytes * 2}-${partSizeBytes * 2 + 2}`,
        },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(blobStore.uploadPart).toHaveBeenCalledTimes(3)
    expect(blobStore.completeMultipartUpload).toHaveBeenCalledWith(
      plan.pathname,
      [
        { etag: "etag-1", partNumber: 1 },
        { etag: "etag-2", partNumber: 2 },
        { etag: "etag-3", partNumber: 3 },
      ],
      expect.objectContaining({
        key: "blob-key",
        uploadId: "upload-1",
      }),
    )
    expect(completed.url).toBe("https://blob.example/result.zip")
  })

  it("falls back to a one-byte range request when HEAD does not expose ZIP size", async () => {
    const sizeBytes = 12_345
    const fetchResult = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, { status: 405 })
      }

      return new Response(Buffer.from("x"), {
        status: 206,
        headers: {
          "content-range": `bytes 0-0/${sizeBytes}`,
        },
      })
    })
    const client = {
      jobs: {
        get: vi.fn(async () => ({
          resultUrl: "https://knowhere.example/result.zip",
        })),
      },
    }
    const blobStore = {
      createMultipartUpload: vi.fn(async () => ({
        key: "blob-key",
        uploadId: "upload-1",
      })),
      uploadPart: vi.fn(),
      completeMultipartUpload: vi.fn(),
    }

    const plan = await createResultZipMultipartUploadPlan({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      client,
      blobStore,
      fetchResult,
    })

    expect(fetchResult).toHaveBeenCalledWith(
      "https://knowhere.example/result.zip",
      expect.objectContaining({
        method: "HEAD",
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchResult).toHaveBeenCalledWith(
      "https://knowhere.example/result.zip",
      expect.objectContaining({
        headers: { Range: "bytes=0-0" },
        signal: expect.any(AbortSignal),
      }),
    )
    expect(plan.sizeBytes).toBe(sizeBytes)
  })
})

describe("prepareParsedResultAssetBatch", () => {
  it("skips saved assets, persists one bounded batch, and reports remaining work", async () => {
    const client = {
      jobs: {
        load: vi.fn(async () => ({
          imageChunks: [
            {
              filePath: "images/image-1.jpg",
              data: Buffer.from("already uploaded"),
            },
            {
              filePath: "images/image-2.png",
              data: Buffer.from("new image"),
            },
          ],
          tableChunks: [
            {
              filePath: "tables/table-1.html",
              html: "<table></table>",
            },
          ],
        })),
      },
    }
    const repository = {
      getParseResultProgress: vi.fn(async () => ({
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/images/image-1.jpg",
        },
      })),
      mergeParseAssetUrls: vi.fn(async () => undefined),
    }
    const blobStore = {
      put: vi.fn(async (pathname: string) => ({
        url: `https://blob.example/${pathname}`,
      })),
    }

    const result = await prepareParsedResultAssetBatch({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      resultBlobUrl: "https://blob.example/result.zip",
      client,
      repository,
      blobStore,
      batchLimit: 1,
    })

    expect(client.jobs.load).toHaveBeenCalledWith("job_1")
    expect(blobStore.put).toHaveBeenCalledWith(
      "workspaces/workspace_1/sources/source_1/parsed-result/images/image-2.png",
      Buffer.from("new image"),
      expect.objectContaining({ contentType: "image/png" }),
    )
    expect(repository.mergeParseAssetUrls).toHaveBeenCalledWith(
      "workspace_1",
      "source_1",
      {
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-2.png":
            "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/images/image-2.png",
        },
      },
    )
    expect(result).toEqual({
      uploadedCount: 1,
      remainingCount: 1,
      hasMore: true,
    })
  })

  it("marks the asset phase complete when every image and table is saved", async () => {
    const client = {
      jobs: {
        load: vi.fn(async () => ({
          imageChunks: [
            {
              filePath: "images/image-1.jpg",
              data: Buffer.from("already uploaded"),
            },
          ],
          tableChunks: [],
        })),
      },
    }
    const repository = {
      getParseResultProgress: vi.fn(async () => ({
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/images/image-1.jpg",
        },
      })),
      mergeParseAssetUrls: vi.fn(async () => undefined),
    }

    const result = await prepareParsedResultAssetBatch({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      resultBlobUrl: "https://blob.example/result.zip",
      client,
      repository,
    })

    expect(repository.mergeParseAssetUrls).not.toHaveBeenCalled()
    expect(result).toEqual({
      uploadedCount: 0,
      remainingCount: 0,
      hasMore: false,
    })
  })

  it("uses indexed document assets to complete without loading the result ZIP", async () => {
    const client = {
      jobs: {
        load: vi.fn(),
      },
      documents: {
        listChunks: vi.fn(async (_documentId: string, params: {
          readonly chunkType: "image" | "table"
        }) => ({
          chunks:
            params.chunkType === "image"
              ? [
                  {
                    filePath: "images/image-1.jpg",
                    sourceChunkPath: null,
                    metadata: {},
                  },
                ]
              : [
                  {
                    filePath: "tables/table-1.html",
                    sourceChunkPath: null,
                    metadata: {},
                  },
                ],
          pagination: {
            totalPages: 1,
          },
        })),
      },
    }
    const repository = {
      getParseResultProgress: vi.fn(async () => ({
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/images/image-1.jpg",
          "tables/table-1.html": "https://blob.example/tables/table-1.html",
        },
      })),
      mergeParseAssetUrls: vi.fn(async () => undefined),
    }

    const result = await prepareParsedResultAssetBatch({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      documentId: "doc_1",
      resultBlobUrl: "https://blob.example/result.zip",
      client,
      repository,
    })

    expect(client.documents.listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 200,
      chunkType: "image",
      includeAssetUrls: false,
    })
    expect(client.documents.listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 200,
      chunkType: "table",
      includeAssetUrls: false,
    })
    expect(client.jobs.load).not.toHaveBeenCalled()
    expect(repository.mergeParseAssetUrls).not.toHaveBeenCalled()
    expect(result).toEqual({
      uploadedCount: 0,
      remainingCount: 0,
      hasMore: false,
    })
  })

  it("falls back to loading the result ZIP when indexed assets are missing", async () => {
    const client = {
      jobs: {
        load: vi.fn(async () => ({
          imageChunks: [
            {
              filePath: "images/image-2.png",
              data: Buffer.from("new image"),
            },
          ],
          tableChunks: [],
        })),
      },
      documents: {
        listChunks: vi.fn(async () => ({
          chunks: [
            {
              filePath: "images/image-2.png",
              sourceChunkPath: null,
              metadata: {},
            },
          ],
          pagination: {
            totalPages: 1,
          },
        })),
      },
    }
    const repository = {
      getParseResultProgress: vi.fn(async () => ({
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {
          "images/image-1.jpg": "https://blob.example/images/image-1.jpg",
        },
      })),
      mergeParseAssetUrls: vi.fn(async () => undefined),
    }
    const blobStore = {
      put: vi.fn(async (pathname: string) => ({
        url: `https://blob.example/${pathname}`,
      })),
    }

    const result = await prepareParsedResultAssetBatch({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      documentId: "doc_1",
      resultBlobUrl: "https://blob.example/result.zip",
      client,
      repository,
      blobStore,
    })

    expect(client.jobs.load).toHaveBeenCalledWith("job_1")
    expect(blobStore.put).toHaveBeenCalledWith(
      "workspaces/workspace_1/sources/source_1/parsed-result/images/image-2.png",
      Buffer.from("new image"),
      expect.objectContaining({ contentType: "image/png" }),
    )
    expect(result).toEqual({
      uploadedCount: 1,
      remainingCount: 0,
      hasMore: false,
    })
  })

  it("falls back to loading the result ZIP when the asset index check fails", async () => {
    const client = {
      jobs: {
        load: vi.fn(async () => ({
          imageChunks: [
            {
              filePath: "images/image-3.png",
              data: Buffer.from("new image"),
            },
          ],
          tableChunks: [],
        })),
      },
      documents: {
        listChunks: vi.fn(async () => {
          throw new Error("index unavailable")
        }),
      },
    }
    const repository = {
      getParseResultProgress: vi.fn(async () => ({
        resultBlobUrl: "https://blob.example/result.zip",
        assetUrlsByFilePath: {},
      })),
      mergeParseAssetUrls: vi.fn(async () => undefined),
    }
    const blobStore = {
      put: vi.fn(async (pathname: string) => ({
        url: `https://blob.example/${pathname}`,
      })),
    }

    const result = await prepareParsedResultAssetBatch({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      jobId: "job_1",
      documentId: "doc_1",
      resultBlobUrl: "https://blob.example/result.zip",
      client,
      repository,
      blobStore,
    })

    expect(client.jobs.load).toHaveBeenCalledWith("job_1")
    expect(blobStore.put).toHaveBeenCalledWith(
      "workspaces/workspace_1/sources/source_1/parsed-result/images/image-3.png",
      Buffer.from("new image"),
      expect.objectContaining({ contentType: "image/png" }),
    )
    expect(result).toEqual({
      uploadedCount: 1,
      remainingCount: 0,
      hasMore: false,
    })
  })
})

function makeJobResult(): JobResult {
  return {
    jobId: "job_1",
    status: "done",
    sourceType: "file",
    namespace: "notebook-workspace_1",
    documentId: "doc_1",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    isDone: true,
    isFailed: false,
    isTerminal: true,
  }
}
