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
    demoKey: null,
    createdAt: new Date("2026-06-04T00:00:00Z"),
    updatedAt: new Date("2026-06-04T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}
