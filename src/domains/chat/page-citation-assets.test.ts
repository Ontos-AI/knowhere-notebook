import { describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import { enrichRetrievalResultsWithPageCitationAssetUrls } from "./page-citation-assets"

describe("enrichRetrievalResultsWithPageCitationAssetUrls", () => {
  it("does not use direct server-provided page asset URLs from result metadata", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            pageNums: [2],
            pageAssets: [
              {
                pageNum: 2,
                artifactRef: "page_citation_assets/page-2.png",
                assetUrl: "https://assets.example/pages/page-2.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
    })

    expect(result?.pageCitationAssetUrl).toBeUndefined()
  })

  it("uses stored Blob URLs for page citation assets", async () => {
    const hardenChatAssetUrl = vi
      .fn()
      .mockResolvedValue("https://blob.example/page_citation_assets/page-2.png")

    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            pageNums: [2],
            pageAssets: [
              {
                pageNum: 2,
                artifactRef: "page_citation_assets/page-2.png",
                assetUrl: "https://assets.example/pages/page-2.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
      hardenChatAssetUrl,
    })

    expect(hardenChatAssetUrl).toHaveBeenCalledWith({
      source: expect.objectContaining({ id: "source_1" }),
      sourcePath: "page_citation_assets/page-2.png",
      assetUrl: "https://assets.example/pages/page-2.png",
      contentType: undefined,
    })
    expect(result?.pageCitationAssetUrl).toBe(
      "https://blob.example/page_citation_assets/page-2.png",
    )
  })

  it("chooses the stored asset matching the citation page metadata", async () => {
    const hardenChatAssetUrl = vi
      .fn()
      .mockResolvedValue("https://blob.example/page_citation_assets/page-4.png")

    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            pageNums: [4],
            pageAssets: [
              {
                pageNum: 2,
                artifactRef: "page_citation_assets/page-2.png",
                assetUrl: "https://assets.example/pages/page-2.png",
              },
              {
                pageNum: 4,
                artifactRef: "page_citation_assets/page-4.png",
                assetUrl: "https://assets.example/pages/page-4.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
      hardenChatAssetUrl,
    })

    expect(hardenChatAssetUrl).toHaveBeenCalledWith({
      source: expect.objectContaining({ id: "source_1" }),
      sourcePath: "page_citation_assets/page-4.png",
      assetUrl: "https://assets.example/pages/page-4.png",
      contentType: undefined,
    })
    expect(result?.pageCitationAssetUrl).toBe(
      "https://blob.example/page_citation_assets/page-4.png",
    )
  })

  it("does not invent a link when the server only provides an artifact ref", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            pageNums: [4],
            pageAssets: [
              {
                pageNum: 4,
                artifactRef: "page_citation_assets/page-4.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
    })

    expect(result?.pageCitationAssetUrl).toBeUndefined()
    expect(result?.pageCitationPageNumber).toBe(4)
  })

  it("sets the page number from page_nums even when page assets are missing", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: { page_nums: "25" },
          source: {
            documentId: "doc_1",
            sourceFileName: "spacex-s1.pdf",
            sectionPath: "spacex-s1.pdf / MD&A",
          },
        }),
      ],
      sources: [makeSource()],
    })

    expect(result?.pageCitationAssetUrl).toBeUndefined()
    expect(result?.pageCitationPageNumber).toBe(25)
  })

  it("reads snake_case page_assets for the cited page number", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            page_nums: [11],
            page_assets: [
              {
                page_num: 11,
                artifact_ref: "page_citation_assets/page-11.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
    })

    expect(result?.pageCitationPageNumber).toBe(11)
  })

  it("attaches page numbers to text citations without turning them into page images", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "text",
          metadata: {
            pageNums: [4],
            pageAssets: [
              {
                pageNum: 4,
                artifactRef: "page_citation_assets/page-4.png",
                assetUrl: "https://assets.example/pages/page-4.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
    })

    expect(result?.pageCitationAssetUrl).toBeUndefined()
    expect(result?.pageCitationPageNumber).toBe(4)
  })
})

function makeRetrievalResult(
  overrides: Partial<RetrievalResult> = {},
): RetrievalResult {
  return {
    chunkId: "chunk_page_4",
    content: "Page four summary",
    chunkType: "page",
    score: 0.8,
    metadata: { pageNums: [4] },
    source: {
      documentId: "doc_1",
      sourceFileName: "source.pdf",
      sectionPath: "Page 4",
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
    sizeBytes: 1,
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
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  }
}
