import { describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import {
  enrichRetrievalResultsWithAssetUrls,
  formatRetrievedMediaAssetContext,
  isImageAssetUrl,
  removeRetrievedMediaAssetUrls,
} from "./media-assets"
import type { Source } from "@/infrastructure/db/schema"

describe("chat media assets", () => {
  it("enriches retrieved image chunks from Notebook parsed asset URLs", async () => {
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/image-9-Night Rocket Launch.jpg":
        "https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
    })

    const [result] = await enrichRetrievalResultsWithAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "image",
          source: {
            documentId: "doc_spacex",
            sourceFileName: "spacex-s1.pdf",
            sectionPath: "Assets / images / image-9-Night Rocket Launch.jpg",
          },
        }),
      ],
      sources: [
        makeSource({
          id: "source_spacex",
          knowhereDocumentId: "doc_spacex",
        }),
      ],
      loadSourceAssetUrls,
    })

    expect(loadSourceAssetUrls).toHaveBeenCalledTimes(1)
    expect(result?.assetUrl).toBe(
      "https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
    )
  })

  it("prefers Notebook parsed asset URLs over existing upstream asset URLs", async () => {
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/image-6-情感分类模型.jpg":
        "https://blob.example/workspaces/workspace_1/sources/source_doc/parsed-result/images/image-6-model.jpg",
    })

    const [result] = await enrichRetrievalResultsWithAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl:
            "https://knowhere-storage.example/results/job_1/images/image-6-%E6%83%85%E6%84%9F%E5%88%86%E7%B1%BB%E6%A8%A1%E5%9E%8B.jpg?AWSAccessKeyId=test",
          source: {
            documentId: "doc_model",
            sourceFileName: "model.pdf",
            sectionPath: "images/image-6-情感分类模型.jpg",
          },
        }),
      ],
      sources: [
        makeSource({
          id: "source_doc",
          knowhereDocumentId: "doc_model",
        }),
      ],
      loadSourceAssetUrls,
    })

    expect(result?.assetUrl).toBe(
      "https://blob.example/workspaces/workspace_1/sources/source_doc/parsed-result/images/image-6-model.jpg",
    )
  })

  it("adds image citation results for asset filenames that only appear in evidence text", async () => {
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/image-6-中华人民共和国居民身份证.jpg":
        "https://blob.example/images/image-6-id-front.jpg",
      "images/image-7-中国居民身份证.jpg":
        "https://blob.example/images/image-7-id-back.jpg",
    })

    const results = await enrichRetrievalResultsWithAssetUrls({
      results: [
        makeRetrievalResult({
          content: "The section contains citizen identity proof copies.",
          source: {
            documentId: "doc_identity",
            sourceFileName: "商务标文件.pdf",
            sectionPath: "二、法定代表人身份证明",
          },
        }),
      ],
      sources: [
        makeSource({
          id: "source_identity",
          title: "商务标文件.pdf",
          knowhereDocumentId: "doc_identity",
        }),
      ],
      loadSourceAssetUrls,
      evidenceText:
        "[image-6-中华人民共和国居民身份证.jpg]\n[image-7-中国居民身份证.jpg]",
    })

    expect(results).toHaveLength(3)
    expect(results[0]?.assetUrl).toBeUndefined()
    expect(results.slice(1).map((result) => result.assetUrl)).toEqual([
      "https://blob.example/images/image-6-id-front.jpg",
      "https://blob.example/images/image-7-id-back.jpg",
    ])
    expect(results.slice(1).map((result) => result.chunkType)).toEqual([
      "image",
      "image",
    ])
    expect(results.slice(1).map((result) => result.source.sectionPath)).toEqual([
      "images/image-6-中华人民共和国居民身份证.jpg",
      "images/image-7-中国居民身份证.jpg",
    ])
  })

  it("deduplicates media citation assets globally by asset URL", async () => {
    const assetUrl = "https://blob.example/images/id-front.jpg"

    const results = await enrichRetrievalResultsWithAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl,
          source: {
            documentId: "doc_identity",
            sourceFileName: "商务标文件.pdf",
            sectionPath: "images/id-front.jpg",
          },
        }),
        makeRetrievalResult({
          chunkType: "image",
          assetUrl,
          source: {
            documentId: "doc_identity",
            sourceFileName: "商务标文件.pdf",
            sectionPath: "二、法定代表人身份证明 / 身份证正面",
          },
        }),
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: "https://blob.example/images/id-back.jpg",
          source: {
            documentId: "doc_identity",
            sourceFileName: "商务标文件.pdf",
            sectionPath: "二、法定代表人身份证明 / 身份证反面",
          },
        }),
      ],
      sources: [],
    })

    expect(results.map((result) => result.assetUrl)).toEqual([
      assetUrl,
      "https://blob.example/images/id-back.jpg",
    ])
    expect(results[0]?.source.sectionPath).toBe(
      "二、法定代表人身份证明 / 身份证正面",
    )
  })

  it("deduplicates equivalent media assets served from different URLs", async () => {
    const results = await enrichRetrievalResultsWithAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl:
            "https://knowhere-storage.example/results/job_1/images/id-front.jpg?AWSAccessKeyId=test",
          source: {
            documentId: "doc_identity",
            sourceFileName: "商务标文件.pdf",
            sectionPath: "Root",
          },
        }),
        makeRetrievalResult({
          chunkType: "image",
          assetUrl:
            "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/images/id-front.jpg",
          source: {
            documentId: "doc_identity",
            sourceFileName: "商务标文件.pdf",
            sectionPath: "images/id-front.jpg",
          },
        }),
      ],
      sources: [],
    })

    expect(results.map((result) => result.assetUrl)).toEqual([
      "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/images/id-front.jpg",
    ])
    expect(results[0]?.source.sectionPath).toBe("images/id-front.jpg")
  })

  it("formats a bounded media asset context for the grounded prompt", () => {
    const context = formatRetrievedMediaAssetContext([
      makeRetrievalResult({
        chunkType: "image",
        assetUrl: "https://blob.example/images/launch.jpg",
        source: {
          documentId: "doc_spacex",
          sourceFileName: "spacex-s1.pdf",
          sectionPath: "Assets / images / launch.jpg",
        },
      }),
    ])

    expect(context).toBe(
      "- spacex-s1.pdf / Assets / images / launch.jpg: https://blob.example/images/launch.jpg",
    )
  })

  it("recognizes image asset URLs with query strings", () => {
    expect(
      isImageAssetUrl("https://blob.example/images/launch.jpg?download=1"),
    ).toBe(true)
    expect(isImageAssetUrl("https://blob.example/tables/table-1.html")).toBe(
      false,
    )
  })

  it("removes retrieved raw asset URLs from generated answer text", () => {
    const answer = removeRetrievedMediaAssetUrls(
      "Use this launch photo. [Open image](https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg) It is from the filing.",
      [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl:
            "https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
        }),
      ],
    )

    expect(answer).toBe(
      "Use this launch photo. Open image It is from the filing.",
    )
    expect(answer).not.toContain("https://blob.example")
  })

  it("removes internal media JSON blocks from generated answer text", () => {
    const answer = removeRetrievedMediaAssetUrls(
      [
        "这里是相关身份证图片。",
        "{\"asset_id\":\"asset_front\",\"assetUrl\":\"https://blob.example/images/id-front.jpg\",\"chunk_id\":\"chunk_front\"}",
      ].join("\n"),
      [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: "https://blob.example/images/id-front.jpg",
        }),
      ],
    )

    expect(answer).toBe("这里是相关身份证图片。")
    expect(answer).not.toMatch(/asset_id|assetUrl|chunk_id|https?:\/\//)
  })

  it("preserves ordinary JSON answers that do not expose internal metadata", () => {
    const answer = removeRetrievedMediaAssetUrls(
      "{\"name\":\"冯荣洲\",\"status\":\"matched\"}",
      [],
    )

    expect(answer).toBe("{\"name\":\"冯荣洲\",\"status\":\"matched\"}")
  })
})

function makeRetrievalResult(
  overrides: Partial<RetrievalResult> = {},
): RetrievalResult {
  return {
    content: "Image evidence",
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
    knowhereJobId: "job_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-06-04T00:00:00Z"),
    updatedAt: new Date("2026-06-04T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}
