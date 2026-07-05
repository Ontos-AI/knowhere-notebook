import "server-only"

import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type { HardenChatAssetUrl } from "./media-assets"

export type PageCitationAssetRetrievalResult = RetrievalResult & {
  readonly pageCitationAssetUrl?: string
}

type EnrichRetrievalResultsWithPageCitationAssetUrlsInput = {
  readonly results: readonly RetrievalResult[]
  readonly sources: readonly Source[]
  readonly hardenChatAssetUrl?: HardenChatAssetUrl
}

type PageCitationAssetCandidate = {
  readonly pageNum: number
  readonly artifactRef?: string
  readonly assetUrl?: string
  readonly contentType?: string
}

export async function enrichRetrievalResultsWithPageCitationAssetUrls({
  results,
  sources,
  hardenChatAssetUrl,
}: EnrichRetrievalResultsWithPageCitationAssetUrlsInput): Promise<
  PageCitationAssetRetrievalResult[]
> {
  if (results.length === 0) return []

  const sourcesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, Source][] =>
      source.knowhereDocumentId ? [[source.knowhereDocumentId, source]] : [],
    ),
  )
  return Promise.all(
    results.map((result) =>
      enrichRetrievalResultWithPageCitationAssetUrl({
        result,
        sourcesByDocumentId,
        hardenChatAssetUrl,
      }),
    ),
  )
}

async function enrichRetrievalResultWithPageCitationAssetUrl(input: {
  readonly result: RetrievalResult
  readonly sourcesByDocumentId: ReadonlyMap<string, Source>
  readonly hardenChatAssetUrl?: HardenChatAssetUrl
}): Promise<PageCitationAssetRetrievalResult> {
  if (!isPageResult(input.result)) return input.result

  const pageNumbers = getPageNumbers(input.result.metadata)
  const directAsset = getDirectPageCitationAsset(input.result, pageNumbers)
  const sourceAssetUrl = await getStoredPageCitationAssetUrl({
    result: input.result,
    directAsset,
    sourcesByDocumentId: input.sourcesByDocumentId,
    hardenChatAssetUrl: input.hardenChatAssetUrl,
  })
  if (sourceAssetUrl) {
    return {
      ...input.result,
      pageCitationAssetUrl: sourceAssetUrl,
    }
  }

  return input.result
}

async function getStoredPageCitationAssetUrl(input: {
  readonly result: RetrievalResult
  readonly directAsset: PageCitationAssetCandidate | null
  readonly sourcesByDocumentId: ReadonlyMap<string, Source>
  readonly hardenChatAssetUrl?: HardenChatAssetUrl
}): Promise<string | null> {
  const artifactRef = getTrimmedString(input.directAsset?.artifactRef)
  const documentId = getTrimmedString(input.result.source.documentId)
  if (!artifactRef || !documentId || !input.hardenChatAssetUrl) return null

  const source = input.sourcesByDocumentId.get(documentId)
  if (!source) return null

  return input.hardenChatAssetUrl({
    source,
    sourcePath: artifactRef,
    assetUrl: input.directAsset?.assetUrl,
    contentType: input.directAsset?.contentType,
  }).catch(() => null)
}

function isPageResult(result: RetrievalResult): boolean {
  return result.chunkType.toLowerCase() === "page"
}

function getDirectPageCitationAsset(
  result: RetrievalResult,
  pageNumbers: readonly number[],
): PageCitationAssetCandidate | null {
  const candidates = parsePageCitationAssetCandidates(result.metadata?.pageAssets)

  if (pageNumbers.length > 0) {
    const matchingCandidates = candidates.filter((candidate) =>
      pageNumbers.includes(candidate.pageNum),
    )
    if (matchingCandidates[0]) return matchingCandidates[0]
  }

  return candidates[0] ?? null
}

function parsePageCitationAssetCandidates(
  value: unknown,
): readonly PageCitationAssetCandidate[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): PageCitationAssetCandidate[] => {
    if (!isRecord(item)) return []
    const pageNum = getPositiveInteger(item.pageNum)
    if (!pageNum) return []

    return [
      {
        pageNum,
        artifactRef: getTrimmedString(item.artifactRef) ?? undefined,
        assetUrl: getTrimmedString(item.assetUrl) ?? undefined,
        contentType: getTrimmedString(item.contentType) ?? undefined,
      },
    ]
  })
}

function getPageNumbers(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly number[] {
  if (!metadata) return []

  const values = [metadata.pageNums, metadata.page_nums, metadata.pageNum]
  const pageNumbers = new Set<number>()

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const pageNum = getPositiveInteger(item)
        if (pageNum) pageNumbers.add(pageNum)
      }
      continue
    }

    const pageNum = getPositiveInteger(value)
    if (pageNum) pageNumbers.add(pageNum)
  }

  return [...pageNumbers].sort((left, right) => left - right)
}

function getTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getPositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
