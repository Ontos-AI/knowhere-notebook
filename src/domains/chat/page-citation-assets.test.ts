import { describe, expect, it } from "vitest"
import type {
  KnowhereSdkStorage,
  KnowhereSdkStorageHead,
  KnowhereSdkStorageObject,
  KnowhereSdkStorageReadResult,
  KnowhereSdkStorageWriteResult,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import { enrichRetrievalResultsWithPageCitationAssetUrls } from "./page-citation-assets"

class MemorySdkStorage implements KnowhereSdkStorage {
  private readonly objects = new Map<string, Uint8Array>()

  constructor(objects: Readonly<Record<string, string>>) {
    for (const [key, value] of Object.entries(objects)) {
      this.objects.set(key, new TextEncoder().encode(value))
    }
  }

  headObject(): Promise<KnowhereSdkStorageHead | null> {
    return Promise.resolve(null)
  }

  writeObject(
    input: KnowhereSdkStorageObject,
  ): Promise<KnowhereSdkStorageWriteResult> {
    if (input.body instanceof Uint8Array) {
      this.objects.set(input.key, new Uint8Array(input.body))
    }
    return Promise.resolve({ key: input.key })
  }

  readObject(key: string): Promise<KnowhereSdkStorageReadResult | null> {
    const body = this.objects.get(key)
    return Promise.resolve(body ? { body } : null)
  }

  getObjectUrl(key: string): Promise<string | null> {
    return Promise.resolve(`https://blob.example/${key}`)
  }
}

describe("enrichRetrievalResultsWithPageCitationAssetUrls", () => {
  it("adds a page citation asset URL for page results with matching metadata", async () => {
    const storage = new MemorySdkStorage({
      "page-citation-assets/documents/doc_1/current.json": JSON.stringify({
        version: 1,
        documentId: "doc_1",
        jobId: "job_1",
        variant: "default",
        indexKey:
          "page-citation-assets/documents/doc_1/jobs/job_1/variants/default/index.json",
        updatedAt: "2026-07-03T00:00:00.000Z",
      }),
      "page-citation-assets/documents/doc_1/jobs/job_1/variants/default/index.json":
        JSON.stringify({
          version: 1,
          documentId: "doc_1",
          jobId: "job_1",
          variant: "default",
          generatedAt: "2026-07-03T00:00:00.000Z",
          assets: [
            {
              pageNum: 4,
              key: "page-citation-assets/documents/doc_1/jobs/job_1/variants/default/scale-1/page-000004.png",
              assetUrl: "https://blob.example/pages/page-000004.png",
              mimeType: "image/png",
              width: 1200,
              height: 1600,
              source: "client-rendered-pdf-page",
              variant: "default",
            },
          ],
        }),
    })

    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: { pageNums: [4] },
        }),
      ],
      sources: [makeSource()],
      storage,
    })

    expect(result?.pageCitationAssetUrl).toBe(
      "https://blob.example/pages/page-000004.png",
    )
  })

  it("uses SDK-enriched page asset metadata before reading the index", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            pageAssets: [
              {
                pageNum: 2,
                key: "page-key",
                assetUrl: "https://blob.example/pages/page-000002.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
      storage: new MemorySdkStorage({}),
    })

    expect(result?.pageCitationAssetUrl).toBe(
      "https://blob.example/pages/page-000002.png",
    )
  })

  it("chooses the SDK-enriched asset matching the citation page metadata", async () => {
    const [result] = await enrichRetrievalResultsWithPageCitationAssetUrls({
      results: [
        makeRetrievalResult({
          chunkType: "page",
          metadata: {
            pageNums: [4],
            pageAssets: [
              {
                pageNum: 2,
                key: "page-2-key",
                assetUrl: "https://blob.example/pages/page-000002.png",
              },
              {
                pageNum: 4,
                key: "page-4-key",
                assetUrl: "https://blob.example/pages/page-000004.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
      storage: new MemorySdkStorage({}),
    })

    expect(result?.pageCitationAssetUrl).toBe(
      "https://blob.example/pages/page-000004.png",
    )
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
                key: "page-key",
                assetUrl: "https://blob.example/pages/page-000004.png",
              },
            ],
          },
        }),
      ],
      sources: [makeSource()],
      storage: new MemorySdkStorage({}),
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
