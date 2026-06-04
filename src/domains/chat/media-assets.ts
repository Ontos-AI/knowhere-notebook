import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

const retrievedMediaAssetLimit = 6
const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"] as const

export type LoadSourceAssetUrls = (
  source: Source,
) => Promise<Readonly<Record<string, string>>>

export type RetrievalResultAssetInput = {
  readonly results: readonly RetrievalResult[]
  readonly sources: readonly Source[]
  readonly loadSourceAssetUrls?: LoadSourceAssetUrls
}

export async function enrichRetrievalResultsWithAssetUrls({
  results,
  sources,
  loadSourceAssetUrls,
}: RetrievalResultAssetInput): Promise<RetrievalResult[]> {
  if (!loadSourceAssetUrls || results.length === 0) return [...results]

  const sourcesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, Source][] =>
      source.knowhereDocumentId ? [[source.knowhereDocumentId, source]] : [],
    ),
  )
  const assetUrlsBySourceId = new Map<
    string,
    Promise<Readonly<Record<string, string>>>
  >()

  return Promise.all(
    results.map(async (result): Promise<RetrievalResult> => {
      if (getTrimmedString(result.assetUrl)) return result

      const documentId = getTrimmedString(result.source.documentId)
      const source = documentId ? sourcesByDocumentId.get(documentId) : undefined
      if (!source) return result

      const assetUrls = await getCachedSourceAssetUrls(
        source,
        loadSourceAssetUrls,
        assetUrlsBySourceId,
      )
      const assetUrl = resolveResultAssetUrl(result, assetUrls)
      return assetUrl ? { ...result, assetUrl } : result
    }),
  )
}

export function formatRetrievedMediaAssetContext(
  results: readonly RetrievalResult[],
): string | undefined {
  const lines: string[] = []
  const seen = new Set<string>()

  for (const result of results) {
    const assetUrl = getTrimmedString(result.assetUrl)
    if (!assetUrl || !isRenderableMediaAsset(result, assetUrl)) continue

    const label = formatResultAssetLabel(result)
    const key = `${label}\0${assetUrl}`
    if (seen.has(key)) continue

    seen.add(key)
    lines.push(`- ${label}: ${assetUrl}`)
    if (lines.length >= retrievedMediaAssetLimit) break
  }

  return lines.length > 0 ? lines.join("\n") : undefined
}

export function isImageAssetUrl(assetUrl: string): boolean {
  const pathname = getUrlPathname(assetUrl).toLowerCase()
  return imageExtensions.some((extension) => pathname.endsWith(extension))
}

async function getCachedSourceAssetUrls(
  source: Source,
  loadSourceAssetUrls: LoadSourceAssetUrls,
  cache: Map<string, Promise<Readonly<Record<string, string>>>>,
): Promise<Readonly<Record<string, string>>> {
  let cached = cache.get(source.id)
  if (!cached) {
    cached = loadSourceAssetUrls(source).catch(() => ({}))
    cache.set(source.id, cached)
  }
  return cached
}

function resolveResultAssetUrl(
  result: RetrievalResult,
  assetUrlsByFilePath: Readonly<Record<string, string>>,
): string | null {
  const normalizedHaystacks = [
    result.source.sectionPath,
    result.content,
  ].flatMap((value): string[] => {
    const normalized = normalizeAssetLookupText(value)
    return normalized ? [normalized] : []
  })
  if (normalizedHaystacks.length === 0) return null

  const basenameCounts = getNormalizedBasenameCounts(assetUrlsByFilePath)
  const matches = Object.entries(assetUrlsByFilePath)
    .flatMap(([assetPath, assetUrl]): readonly AssetReferenceMatch[] => {
      const trimmedUrl = getTrimmedString(assetUrl)
      if (!trimmedUrl || !isSupportedAssetPath(assetPath)) return []

      const index = getAssetReferenceIndex(
        normalizedHaystacks,
        assetPath,
        basenameCounts,
      )
      return index === null ? [] : [{ assetPath, assetUrl: trimmedUrl, index }]
    })
    .sort(compareAssetReferenceMatches)

  return matches[0]?.assetUrl ?? null
}

type AssetReferenceMatch = {
  readonly assetPath: string
  readonly assetUrl: string
  readonly index: number
}

function compareAssetReferenceMatches(
  left: AssetReferenceMatch,
  right: AssetReferenceMatch,
): number {
  return left.index - right.index || left.assetPath.localeCompare(right.assetPath)
}

function getAssetReferenceIndex(
  normalizedHaystacks: readonly string[],
  assetPath: string,
  basenameCounts: ReadonlyMap<string, number>,
): number | null {
  const normalizedPath = normalizeAssetLookupText(assetPath)
  if (!normalizedPath) return null

  const directIndex = getFirstIndex(normalizedHaystacks, normalizedPath)
  if (directIndex !== null) return directIndex

  const basename = getNormalizedBasename(assetPath)
  if (!basename || basenameCounts.get(basename) !== 1) return null

  return getFirstIndex(normalizedHaystacks, basename)
}

function getFirstIndex(
  normalizedHaystacks: readonly string[],
  needle: string,
): number | null {
  const indexes = normalizedHaystacks
    .map((haystack): number => haystack.indexOf(needle))
    .filter((index): index is number => index >= 0)

  return indexes.length > 0 ? Math.min(...indexes) : null
}

function getNormalizedBasenameCounts(
  assetUrlsByFilePath: Readonly<Record<string, string>>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const assetPath of Object.keys(assetUrlsByFilePath)) {
    const basename = getNormalizedBasename(assetPath)
    if (!basename) continue
    counts.set(basename, (counts.get(basename) ?? 0) + 1)
  }
  return counts
}

function getNormalizedBasename(assetPath: string): string | null {
  const basename = assetPath.replaceAll("\\", "/").split("/").pop()
  return normalizeAssetLookupText(basename)
}

function normalizeAssetLookupText(value: string | null | undefined): string | null {
  const trimmedValue = getTrimmedString(value)
  if (!trimmedValue) return null

  const normalized = decodeUrlText(trimmedValue)
    .replaceAll("\\", "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

  return normalized.length > 0 ? normalized : null
}

function decodeUrlText(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isSupportedAssetPath(assetPath: string): boolean {
  const normalizedPath = normalizeAssetLookupText(assetPath)
  return (
    normalizedPath?.startsWith("images/") === true ||
    normalizedPath?.startsWith("tables/") === true
  )
}

function isRenderableMediaAsset(
  result: RetrievalResult,
  assetUrl: string,
): boolean {
  const chunkType = result.chunkType.toLowerCase()
  return chunkType === "image" || chunkType === "table" || isImageAssetUrl(assetUrl)
}

function formatResultAssetLabel(result: RetrievalResult): string {
  const sourceFileName = getTrimmedString(result.source.sourceFileName)
  const sectionPath = getTrimmedString(result.source.sectionPath)
  const label = [sourceFileName, sectionPath].filter(Boolean).join(" / ")
  return label || "Retrieved media asset"
}

function getUrlPathname(assetUrl: string): string {
  try {
    return new URL(assetUrl).pathname
  } catch {
    return assetUrl.split("?")[0] ?? assetUrl
  }
}

function getTrimmedString(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? ""
  return trimmedValue.length > 0 ? trimmedValue : null
}
