import "server-only"

import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type { HardenChatAssetUrl } from "./media-assets"

export type PageCitationAssetRetrievalResult = RetrievalResult & {
  readonly pageCitationAssetUrl?: string
  readonly pageCitationPageNumber?: number
  readonly highlightRegions?: readonly {
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
  }[]
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

export function resolvePageCitationPageNumber(
  result: RetrievalResult & { readonly pageCitationPageNumber?: number },
): number | undefined {
  const existing = getPositiveInteger(result.pageCitationPageNumber)
  if (existing) return existing

  const pageNumbers = getPageNumbers(result.metadata)
  const directAsset = getDirectPageCitationAsset(result, pageNumbers)
  return (
    directAsset?.pageNum ??
    pageNumbers[0] ??
    parseSectionPathPageNumber(result.source.sectionPath) ??
    undefined
  )
}

async function enrichRetrievalResultWithPageCitationAssetUrl(input: {
  readonly result: RetrievalResult
  readonly sourcesByDocumentId: ReadonlyMap<string, Source>
  readonly hardenChatAssetUrl?: HardenChatAssetUrl
}): Promise<PageCitationAssetRetrievalResult> {
  const pageNumbers = getPageNumbers(input.result.metadata)
  const directAsset = getDirectPageCitationAsset(input.result, pageNumbers)
  const pageCitationPageNumber = resolvePageCitationPageNumber(input.result)
  const sourceAssetUrl = isPageResult(input.result)
    ? await getStoredPageCitationAssetUrl({
        result: input.result,
        directAsset,
        sourcesByDocumentId: input.sourcesByDocumentId,
        hardenChatAssetUrl: input.hardenChatAssetUrl,
      })
    : null

  if (!sourceAssetUrl && pageCitationPageNumber === undefined) {
    return input.result
  }

  return {
    ...input.result,
    ...(sourceAssetUrl ? { pageCitationAssetUrl: sourceAssetUrl } : {}),
    ...(pageCitationPageNumber
      ? { pageCitationPageNumber }
      : {}),
  }
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
  const candidates = parsePageCitationAssetCandidates(
    result.metadata?.pageAssets ?? result.metadata?.page_assets,
  )

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
    const pageNum =
      getPositiveInteger(item.pageNum) ??
      getPositiveInteger(item.page_num) ??
      getPositiveInteger(item.pageNumber)
    if (!pageNum) return []

    return [
      {
        pageNum,
        artifactRef:
          getTrimmedString(item.artifactRef) ??
          getTrimmedString(item.artifact_ref) ??
          undefined,
        assetUrl:
          getTrimmedString(item.assetUrl) ??
          getTrimmedString(item.asset_url) ??
          undefined,
        contentType:
          getTrimmedString(item.contentType) ??
          getTrimmedString(item.content_type) ??
          undefined,
      },
    ]
  })
}

function getPageNumbers(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly number[] {
  if (!metadata) return []

  const pageNumbers = new Set<number>()
  collectPageNumbers(metadata.pageNums, pageNumbers)
  collectPageNumbers(metadata.page_nums, pageNumbers)
  collectPageNumbers(metadata.pageNum, pageNumbers)
  collectPageNumbers(metadata.page_num, pageNumbers)
  return [...pageNumbers].sort((left, right) => left - right)
}

function collectPageNumbers(value: unknown, pageNumbers: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPageNumbers(item, pageNumbers)
    return
  }

  if (typeof value === "string" && value.includes(",")) {
    for (const part of value.split(",")) collectPageNumbers(part.trim(), pageNumbers)
    return
  }

  const pageNum = getPositiveInteger(value)
  if (pageNum) pageNumbers.add(pageNum)
}

function parseSectionPathPageNumber(
  sectionPath: string | null | undefined,
): number | null {
  if (typeof sectionPath !== "string") return null
  const match =
    /\bpage\s+(\d+)\b/i.exec(sectionPath) ??
    /(?:^|[^\w])p(\d+)(?:[^\w]|$)/i.exec(sectionPath)
  if (!match) return null
  return getPositiveInteger(match[1])
}

function getTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
