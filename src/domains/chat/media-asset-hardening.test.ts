import { afterEach, describe, expect, it, vi } from "vitest"

import type { Source } from "@/infrastructure/db/schema"
import {
  hardenChatMediaAssetUrls,
  isNotebookOwnedAssetUrl,
  type HardenableRetrievalResult,
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
})

describe("hardenChatMediaAssetUrls", () => {
  it("keeps an already Notebook-owned asset URL without loading the asset map", async () => {
    const ownedUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_1/rev_1/assets/images/a.png"
    const loadSourceAssetUrls = vi.fn(async () => ({}))

    const result = await hardenChatMediaAssetUrls({
      workspaceId: "workspace_1",
      sources: [makeSource({ id: "source_1", knowhereDocumentId: "doc_1" })],
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: ownedUrl,
          source: {
            documentId: "doc_1",
            sourceFileName: "model.pdf",
            sectionPath: "Root",
          },
        }),
      ],
      loadSourceAssetUrls,
    })

    expect(result.results[0]?.assetUrl).toBe(ownedUrl)
    expect(loadSourceAssetUrls).not.toHaveBeenCalled()
  })

  it("resolves a raw asset URL to the durable parsed asset URL", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/id-front.jpg?AWSAccessKeyId=test"
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_identity/rev_1/assets/images/id-front.jpg"
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/id-front.jpg": durableUrl,
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
    })

    expect(loadSourceAssetUrls).toHaveBeenCalledWith(
      expect.objectContaining({ id: "source_identity" }),
    )
    expect(result.results[0]?.assetUrl).toBe(durableUrl)
  })

  it("omits an asset URL that cannot be resolved to a durable URL", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/tables/table-1.html?AWSAccessKeyId=test"
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({})

    const result = await hardenChatMediaAssetUrls({
      workspaceId: "workspace_1",
      sources: [
        makeSource({ id: "source_1", knowhereDocumentId: "doc_1" }),
      ],
      results: [
        makeRetrievalResult({
          chunkType: "table",
          assetUrl: rawAssetUrl,
          source: {
            documentId: "doc_1",
            sourceFileName: "source.pdf",
            sectionPath: "tables/table-1.html",
          },
        }),
      ],
      loadSourceAssetUrls,
    })

    expect(result.results[0]?.assetUrl).toBeUndefined()
  })

  it("resolves an artifact asset URL and its nested citation URL", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/front.jpg?AWSAccessKeyId=test"
    const durableUrl =
      "https://fake.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_identity/rev_1/assets/images/front.jpg"
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/front.jpg": durableUrl,
    })

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
      loadSourceAssetUrls,
    })

    const [artifact] = result.artifacts ?? []
    expect(artifact?.assetUrl).toBe(durableUrl)
    expect(artifact?.citation?.assetUrl).toBe(durableUrl)
  })
})

describe("isNotebookOwnedAssetUrl", () => {
  it("treats Vercel Blob hosts and parsed-document paths as owned", () => {
    expect(
      isNotebookOwnedAssetUrl(
        "https://fake.public.blob.vercel-storage.com/x/y.png",
      ),
    ).toBe(true)
    expect(
      isNotebookOwnedAssetUrl(
        "https://cdn.example/workspaces/w/parsed-documents/d/r/assets/a.png",
      ),
    ).toBe(true)
    expect(
      isNotebookOwnedAssetUrl(
        "https://knowhere-storage.example/results/job_1/images/a.png?sig=x",
      ),
    ).toBe(false)
  })
})

function makeRetrievalResult(
  overrides: Partial<HardenableRetrievalResult> = {},
): HardenableRetrievalResult {
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
    failureStage: null,
    knowhereJobId: "job_123",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}
