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
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "page_citation_assets/page-2.png":
        "https://blob.example/page_citation_assets/page-2.png",
    })

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
      loadSourceAssetUrls,
    })

    expect(loadSourceAssetUrls).toHaveBeenCalledWith(
      expect.objectContaining({ id: "source_1" }),
    )
    expect(result?.pageCitationAssetUrl).toBe(
      "https://blob.example/page_citation_assets/page-2.png",
    )
  })

  it("chooses the stored asset matching the citation page metadata", async () => {
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "page_citation_assets/page-4.png":
        "https://blob.example/page_citation_assets/page-4.png",
    })

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
      loadSourceAssetUrls,
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
  })

  it("leaves non-page results unchanged even when they have page metadata", async () => {
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
