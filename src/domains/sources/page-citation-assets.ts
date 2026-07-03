import "server-only"

import { createPdfJsPageRenderer } from "@ontos-ai/knowhere-sdk/page-renderer-pdfjs"
import type {
  KnowhereSdkStorage,
  PageCitationAssetWarning,
  PageCitationAssetsOptions,
  PageRenderer,
} from "@ontos-ai/knowhere-sdk"

import { createVercelBlobKnowhereSdkStorage } from "@/integrations/knowhere-sdk-storage"

type SourcePageCitationAssetClient = {
  readonly knowledge: {
    readonly cacheJobResult: (input: {
      readonly jobId: string
      readonly localDocumentId: string
      readonly pageCitationAssets: PageCitationAssetsOptions
    }) => Promise<{
      readonly pageCitationAssetWarnings?: readonly PageCitationAssetWarning[]
    }>
  }
}

export type PrepareSourcePageCitationAssetsInput = {
  readonly client: SourcePageCitationAssetClient
  readonly sourceId: string
  readonly jobId: string
  readonly documentId: string
  readonly storage?: KnowhereSdkStorage
  readonly renderer?: PageRenderer & { close?: () => Promise<void> }
  readonly maxPagesToRenderPerRun?: number
}

export type PrepareSourcePageCitationAssetsResult = {
  readonly warnings: readonly PageCitationAssetWarning[]
}

const defaultMaxPagesToRenderPerRun = 25

export async function prepareSourcePageCitationAssets({
  client,
  sourceId,
  jobId,
  storage = createVercelBlobKnowhereSdkStorage(),
  renderer,
  maxPagesToRenderPerRun = defaultMaxPagesToRenderPerRun,
}: PrepareSourcePageCitationAssetsInput): Promise<PrepareSourcePageCitationAssetsResult> {
  const pageRenderer = renderer ?? createPdfJsPageRenderer({ maxThreads: 1 })

  try {
    const result = await client.knowledge.cacheJobResult({
      jobId,
      localDocumentId: sourceId,
      pageCitationAssets: {
        storage,
        renderer: pageRenderer,
        strict: false,
        maxPagesToRenderPerRun,
      },
    })

    return {
      warnings: result.pageCitationAssetWarnings ?? [],
    }
  } finally {
    await pageRenderer.close?.().catch(() => undefined)
  }
}
