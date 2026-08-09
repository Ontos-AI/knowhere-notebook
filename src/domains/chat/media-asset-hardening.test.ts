import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import {
  hardenChatMediaAssetUrls,
  type ChatMediaAssetBlobStore,
  type FetchChatMediaAsset,
} from "./media-asset-hardening"

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: loggerMock.warn,
  },
}))

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.KNOWHERE_BASE_URL
})

describe("hardenChatMediaAssetUrls", () => {
  it("copies upstream absolute asset URLs into Notebook chat assets", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/image-6-%E6%83%85%E6%84%9F%E5%88%86%E7%B1%BB%E6%A8%A1%E5%9E%8B.jpg?AWSAccessKeyId=test&Signature=secret"
    const blobStore = makeBlobStore(
      "https://blob.example/workspaces/workspace_1/chat-assets/source-source_1/image-6.jpg",
    )
    const fetchAsset = makeFetchAsset("image-bytes", "image/jpeg")

    const result = await hardenChatMediaAssetUrls({
      workspaceId: "workspace_1",
      sources: [
        makeSource({
          id: "source_1",
          knowhereDocumentId: "doc_model",
        }),
      ],
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: rawAssetUrl,
          source: {
            documentId: "doc_model",
            sourceFileName: "model.pdf",
            sectionPath: "Root",
          },
        }),
      ],
      blobStore,
      fetchAsset,
    })

    expect(fetchAsset).toHaveBeenCalledWith(rawAssetUrl)
    expect(blobStore.put).toHaveBeenCalledWith(
      expect.stringMatching(
        /^workspaces\/workspace_1\/chat-assets\/source-source_1\/[a-f0-9]{24}-image-6\.jpg$/,
      ),
      expect.any(Buffer),
      {
        access: "public",
        allowOverwrite: true,
        contentType: "image/jpeg",
        multipart: true,
      },
    )
    expect(result.results[0]?.assetUrl).toBe(
      "https://blob.example/workspaces/workspace_1/chat-assets/source-source_1/image-6.jpg",
    )
  })

  it("uses an existing parsed asset URL before fetching the upstream URL", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/id-front.jpg?AWSAccessKeyId=test"
    const parsedAssetUrl =
      "https://blob.example/workspaces/workspace_1/sources/source_identity/parsed-result/images/id-front.jpg"
    const blobStore = makeBlobStore("https://blob.example/should-not-upload.jpg")
    const fetchAsset = makeFetchAsset("should-not-fetch", "image/jpeg")
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/id-front.jpg": parsedAssetUrl,
    })

    const result = await hardenChatMediaAssetUrls({
      workspaceId: "workspace_1",
      sources: [
        makeSource({
          id: "source_identity",
          knowhereDocumentId: "doc_identity",
        }),
      ],
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: rawAssetUrl,
          source: {
            documentId: "doc_identity",
            sourceFileName: "identity.pdf",
            sectionPath: "images/id-front.jpg",
          },
        }),
      ],
      loadSourceAssetUrls,
      blobStore,
      fetchAsset,
    })

    expect(loadSourceAssetUrls).toHaveBeenCalledWith(
      expect.objectContaining({ id: "source_identity" }),
    )
    expect(fetchAsset).not.toHaveBeenCalled()
    expect(blobStore.put).not.toHaveBeenCalled()
    expect(result.results[0]?.assetUrl).toBe(parsedAssetUrl)
  })

  it("falls back to the raw URL when hardening fails", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/tables/table-1.html?AWSAccessKeyId=test"
    const blobStore = makeBlobStore("https://blob.example/should-not-exist.html")
    const fetchAsset: FetchChatMediaAsset = vi
      .fn()
      .mockRejectedValue(new Error("expired URL"))

    const result = await hardenChatMediaAssetUrls({
      workspaceId: "workspace_1",
      sources: [],
      results: [
        makeRetrievalResult({
          chunkType: "table",
          assetUrl: rawAssetUrl,
        }),
      ],
      blobStore,
      fetchAsset,
    })

    expect(result.results[0]?.assetUrl).toBe(rawAssetUrl)
    expect(blobStore.put).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "chat-agent: media asset hardening failed; keeping raw URL",
      expect.objectContaining({
        assetUrl:
          "https://knowhere-storage.example/results/job_1/tables/table-1.html",
        error: "expired URL",
      }),
    )
  })

  it("rewrites artifact asset URLs and nested citation asset URLs", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/front.jpg?AWSAccessKeyId=test"
    const blobAssetUrl =
      "https://blob.example/workspaces/workspace_1/chat-assets/source-source_identity/front.jpg"
    const blobStore = makeBlobStore(blobAssetUrl)
    const fetchAsset = makeFetchAsset("front-image", "image/jpeg")

    const result = await hardenChatMediaAssetUrls({
      workspaceId: "workspace_1",
      sources: [
        makeSource({
          id: "source_identity",
          knowhereDocumentId: "doc_identity",
        }),
      ],
      results: [],
      artifacts: [
        {
          type: "image",
          ref: "asset:r1:result:1",
          assetUrl: rawAssetUrl,
          label: "identity.pdf / front / image",
          citation: {
            chunkType: "image",
            score: 0.9,
            assetUrl: rawAssetUrl,
            source: {
              documentId: "doc_identity",
              sourceFileName: "identity.pdf",
              sectionPath: "images/front.jpg",
            },
          },
        },
      ],
      blobStore,
      fetchAsset,
    })

    const [artifact] = result.artifacts ?? []
    expect(fetchAsset).toHaveBeenCalledTimes(1)
    expect(artifact?.assetUrl).toBe(blobAssetUrl)
    expect(artifact?.citation?.assetUrl).toBe(blobAssetUrl)
  })
})

function makeFetchAsset(
  body: string,
  contentType: string,
): FetchChatMediaAsset {
  return vi.fn().mockResolvedValue(
    new Response(Buffer.from(body), {
      status: 200,
      headers: {
        "content-type": contentType,
      },
    }),
  )
}

function makeBlobStore(url: string): ChatMediaAssetBlobStore {
  return {
    put: vi.fn().mockResolvedValue({ url }),
  }
}

function makeRetrievalResult(
  overrides: Partial<RetrievalResult> = {},
): RetrievalResult {
  return {
    content: "Asset evidence",
    chunkType: "text",
    score: 0.9,
    source: {
      documentId: "doc_1",
      sourceFileName: "source.pdf",
      sectionPath: "Root",
    },
    ...overrides,
  }
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "source.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_123",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}
