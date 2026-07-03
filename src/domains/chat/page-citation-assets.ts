import "server-only"

import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

export type PageCitationAssetRetrievalResult = RetrievalResult & {
  readonly pageCitationAssetUrl?: string
}

type EnrichRetrievalResultsWithPageCitationAssetUrlsInput = {
  readonly results: readonly RetrievalResult[]
  readonly sources: readonly Source[]
}

type PageCitationAssetCandidate = {
  readonly pageNum: number
  readonly assetUrl?: string
}

export async function enrichRetrievalResultsWithPageCitationAssetUrls({
  results,
  sources,
}: EnrichRetrievalResultsWithPageCitationAssetUrlsInput): Promise<
  PageCitationAssetRetrievalResult[]
> {
  void sources
  if (results.length === 0) return []

  return Promise.all(
    results.map((result) =>
      enrichRetrievalResultWithPageCitationAssetUrl({
        result,
      }),
    ),
  )
}

async function enrichRetrievalResultWithPageCitationAssetUrl(input: {
  readonly result: RetrievalResult
}): Promise<PageCitationAssetRetrievalResult> {
  if (!isPageResult(input.result)) return input.result

  const pageNumbers = getPageNumbers(input.result.metadata)
  const directAsset = getDirectPageCitationAsset(input.result, pageNumbers)
  if (directAsset?.assetUrl) {
    return {
      ...input.result,
      pageCitationAssetUrl: directAsset.assetUrl,
    }
  }

  return input.result
}

function isPageResult(result: RetrievalResult): boolean {
  return result.chunkType.toLowerCase() === "page"
}

function getDirectPageCitationAsset(
  result: RetrievalResult,
  pageNumbers: readonly number[],
): PageCitationAssetCandidate | null {
  const candidates = [
    isRecord(result) ? result.pageAssets : undefined,
    result.metadata?.pageAssets,
  ].flatMap(parsePageCitationAssetCandidates)

  if (pageNumbers.length > 0) {
    const matchingCandidates = candidates.filter((candidate) =>
      pageNumbers.includes(candidate.pageNum),
    )
    const matchingAssetWithUrl = matchingCandidates.find(
      (candidate) => candidate.assetUrl,
    )
    if (matchingAssetWithUrl) return matchingAssetWithUrl
    if (matchingCandidates[0]) return matchingCandidates[0]
  }

  return candidates.find((candidate) => candidate.assetUrl) ?? candidates[0] ?? null
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
        assetUrl: getTrimmedString(item.assetUrl) ?? undefined,
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
