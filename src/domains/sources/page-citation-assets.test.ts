import { describe, expect, it, vi } from "vitest"
import type {
  KnowhereSdkStorage,
  KnowhereSdkStorageHead,
  KnowhereSdkStorageObject,
  KnowhereSdkStorageReadResult,
  KnowhereSdkStorageWriteResult,
  PageRenderer,
  RenderedPage,
} from "@ontos-ai/knowhere-sdk"

import { prepareSourcePageCitationAssets } from "./page-citation-assets"

class MemoryStorage implements KnowhereSdkStorage {
  headObject(): Promise<KnowhereSdkStorageHead | null> {
    return Promise.resolve(null)
  }

  writeObject(
    input: KnowhereSdkStorageObject,
  ): Promise<KnowhereSdkStorageWriteResult> {
    return Promise.resolve({ key: input.key })
  }

  readObject(): Promise<KnowhereSdkStorageReadResult | null> {
    return Promise.resolve(null)
  }
}

describe("prepareSourcePageCitationAssets", () => {
  it("calls SDK cacheJobResult with tolerant bounded page citation options", async () => {
    const storage = new MemoryStorage()
    const renderer: PageRenderer & { close: () => Promise<void> } = {
      renderPage(): Promise<RenderedPage> {
        return Promise.resolve({
          body: new Uint8Array([1]),
          mimeType: "image/png",
          width: 1,
          height: 1,
        })
      },
      close: vi.fn(async () => undefined),
    }
    const cacheJobResult = vi.fn(async () => ({
      pageCitationAssetWarnings: [
        {
          code: renderLimitExceededCode,
          message: "limit reached",
        },
      ],
    }))

    const result = await prepareSourcePageCitationAssets({
      client: {
        knowledge: {
          cacheJobResult,
        },
      },
      sourceId: "source_1",
      jobId: "job_1",
      documentId: "doc_1",
      storage,
      renderer,
      maxPagesToRenderPerRun: 3,
    })

    expect(cacheJobResult).toHaveBeenCalledWith({
      jobId: "job_1",
      localDocumentId: "source_1",
      pageCitationAssets: {
        storage,
        renderer,
        strict: false,
        maxPagesToRenderPerRun: 3,
      },
    })
    expect(result.warnings).toHaveLength(1)
    expect(renderer.close).toHaveBeenCalled()
  })
})

const renderLimitExceededCode = "render_limit_exceeded" as const
