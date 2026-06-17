import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

const retrievedMediaAssetLimit = 6
const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"] as const
const internalMetadataKeys = new Set([
  "asset_id",
  "assetUrl",
  "asset_url",
  "chunkId",
  "chunk_id",
])

export type LoadSourceAssetUrls = (
  source: Source,
) => Promise<Readonly<Record<string, string>>>

export type RetrievalResultAssetInput = {
  readonly results: readonly RetrievalResult[]
  readonly sources: readonly Source[]
  readonly loadSourceAssetUrls?: LoadSourceAssetUrls
  readonly evidenceText?: string
}

export async function enrichRetrievalResultsWithAssetUrls({
  results,
  sources,
  loadSourceAssetUrls,
  evidenceText,
}: RetrievalResultAssetInput): Promise<RetrievalResult[]> {
  if (!loadSourceAssetUrls || results.length === 0) {
    return dedupeMediaCitationResults(results)
  }

  const sourcesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, Source][] =>
      source.knowhereDocumentId ? [[source.knowhereDocumentId, source]] : [],
    ),
  )
  const assetUrlsBySourceId = new Map<
    string,
    Promise<Readonly<Record<string, string>>>
  >()

  const enrichedResults = await Promise.all(
    results.map(async (result): Promise<readonly RetrievalResult[]> => {
      const documentId = getTrimmedString(result.source.documentId)
      const source = documentId ? sourcesByDocumentId.get(documentId) : undefined
      if (!source) return [result]

      const assetUrls = await getCachedSourceAssetUrls(
        source,
        loadSourceAssetUrls,
        assetUrlsBySourceId,
      )
      return addAssetCitationResults(result, assetUrls, evidenceText)
    }),
  )

  return dedupeMediaCitationResults(enrichedResults.flat())
}

export function dedupeMediaCitationResults(
  results: readonly RetrievalResult[],
): RetrievalResult[] {
  const dedupedResults: RetrievalResult[] = []
  const resultIndexesByAssetKey = new Map<string, number>()

  for (const result of results) {
    const assetUrl = getTrimmedString(result.assetUrl)
    if (!assetUrl || !isRenderableMediaAsset(result, assetUrl)) {
      dedupedResults.push(result)
      continue
    }

    const assetKey = getMediaCitationDedupeKey(result, assetUrl)
    const existingIndex = resultIndexesByAssetKey.get(assetKey)
    if (existingIndex === undefined) {
      resultIndexesByAssetKey.set(assetKey, dedupedResults.length)
      dedupedResults.push(result)
      continue
    }

    const existingResult = dedupedResults[existingIndex]
    const existingAssetUrl = getTrimmedString(existingResult?.assetUrl)
    if (
      existingResult &&
      existingAssetUrl &&
      compareMediaCitationResult(
        result,
        existingResult,
        assetUrl,
        existingAssetUrl,
      ) > 0
    ) {
      dedupedResults[existingIndex] = result
    }
  }

  return dedupedResults
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

export function removeRetrievedMediaAssetUrls(
  answer: string,
  results: readonly RetrievalResult[],
): string {
  const assetUrls = Array.from(
    new Set(
      results
        .map((result): string | null => getTrimmedString(result.assetUrl))
        .filter((assetUrl): assetUrl is string => assetUrl !== null),
    ),
  )
  const urlSanitizedAnswer =
    assetUrls.length > 0
      ? assetUrls
          .flatMap(getAssetUrlTextVariants)
          .reduce(removeAssetUrlFromAnswer, answer)
      : answer
  const sanitizedAnswer = removeInternalMetadataJsonBlocks(urlSanitizedAnswer)

  return cleanSanitizedAnswer(sanitizedAnswer)
}

function compareMediaCitationResult(
  candidate: RetrievalResult,
  current: RetrievalResult,
  candidateAssetUrl: string,
  currentAssetUrl: string,
): number {
  return (
    getMediaCitationResultScore(candidate, candidateAssetUrl) -
    getMediaCitationResultScore(current, currentAssetUrl)
  )
}

function getMediaCitationResultScore(
  result: RetrievalResult,
  assetUrl: string,
): number {
  const chunkType = result.chunkType.toLowerCase()
  const isImageAsset = isImageAssetUrl(assetUrl)
  const isTableAsset = chunkType === "table"
  const source = result.source
  let score = 0

  if (chunkType === "image" && isImageAsset) score += 100
  if (isTableAsset) score += 90
  if (chunkType === "image" || chunkType === "table") score += 30
  if (getTrimmedString(source.documentId)) score += 10
  if (getTrimmedString(source.sourceFileName)) score += 20

  const sectionPath = getTrimmedString(source.sectionPath)
  if (sectionPath && !isGenericSectionPath(sectionPath)) {
    score += 30
    if (!isAssetFilePath(sectionPath)) score += 15
    score += Math.min(sectionPath.length, 120) / 12
  }
  if (isNotebookParsedAssetUrl(assetUrl)) score += 25

  return score
}

function getMediaCitationDedupeKey(
  result: RetrievalResult,
  assetUrl: string,
): string {
  const documentKey =
    getTrimmedString(result.source.documentId) ??
    getTrimmedString(result.source.sourceFileName) ??
    "unknown"
  const assetPath =
    getCanonicalAssetPathFromSource(result) ?? getCanonicalAssetPathFromUrl(assetUrl)

  return assetPath ? `asset:${documentKey}:${assetPath}` : `url:${assetUrl}`
}

function getCanonicalAssetPathFromSource(
  result: RetrievalResult,
): string | null {
  const sectionPath = normalizeAssetLookupText(result.source.sectionPath)
  return sectionPath && isSupportedAssetPath(sectionPath) ? sectionPath : null
}

function getCanonicalAssetPathFromUrl(assetUrl: string): string | null {
  const normalizedPath = normalizeAssetLookupText(getUrlPathname(assetUrl))
  if (!normalizedPath) return null

  const pathMatch = /(?:^|\/)((?:images|tables)\/[^?#]+)$/.exec(normalizedPath)
  if (pathMatch?.[1]) return pathMatch[1]

  const basename = getNormalizedBasename(normalizedPath)
  if (!basename) return null

  if (isImageAssetUrl(assetUrl)) return `images/${basename}`
  return null
}

function isGenericSectionPath(value: string): boolean {
  return ["root", "unknown source"].includes(value.trim().toLowerCase())
}

function isNotebookParsedAssetUrl(assetUrl: string): boolean {
  return normalizeAssetLookupText(getUrlPathname(assetUrl))?.includes(
    "/parsed-result/",
  ) === true
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

function addAssetCitationResults(
  result: RetrievalResult,
  assetUrlsByFilePath: Readonly<Record<string, string>>,
  evidenceText: string | undefined,
): readonly RetrievalResult[] {
  const existingAssetUrl = getTrimmedString(result.assetUrl)
  const resultMatches = resolveAssetReferenceMatches(result, assetUrlsByFilePath)
  const evidenceMatches = resolveAssetReferenceMatchesFromText(
    evidenceText,
    assetUrlsByFilePath,
  )
  const seenAssetUrls = new Set<string>()
  const output: RetrievalResult[] = []

  if (resultMatches.length > 0) {
    const [firstMatch, ...remainingMatches] = resultMatches
    seenAssetUrls.add(firstMatch.assetUrl)
    output.push(toAssetResult(result, firstMatch))
    for (const match of remainingMatches) {
      if (seenAssetUrls.has(match.assetUrl)) continue
      seenAssetUrls.add(match.assetUrl)
      output.push(toAssetResult(result, match))
    }
  } else if (existingAssetUrl) {
    seenAssetUrls.add(existingAssetUrl)
    output.push(result)
  } else {
    output.push(result)
  }

  for (const match of evidenceMatches) {
    if (seenAssetUrls.has(match.assetUrl)) continue
    seenAssetUrls.add(match.assetUrl)
    output.push(toAssetResult(result, match))
  }

  return output
}

function toAssetResult(
  result: RetrievalResult,
  match: AssetReferenceMatch,
): RetrievalResult {
  return {
    ...result,
    assetUrl: match.assetUrl,
    chunkType: getAssetChunkType(match, result.chunkType),
    source: {
      ...result.source,
      sectionPath: getAssetSectionPath(result, match.assetPath),
    },
  }
}

function getAssetSectionPath(
  result: RetrievalResult,
  assetPath: string,
): string | null | undefined {
  const sectionPath = getTrimmedString(result.source.sectionPath)
  if (!sectionPath) return assetPath

  const normalizedSectionPath = normalizeAssetLookupText(sectionPath)
  const normalizedAssetPath = normalizeAssetLookupText(assetPath)
  const assetBasename = getNormalizedBasename(assetPath)
  if (
    normalizedAssetPath &&
    normalizedSectionPath?.includes(normalizedAssetPath)
  ) {
    return sectionPath
  }
  if (assetBasename && normalizedSectionPath?.includes(assetBasename)) {
    return sectionPath
  }

  return assetPath
}

function getAssetChunkType(
  match: AssetReferenceMatch,
  fallback: RetrievalResult["chunkType"],
): RetrievalResult["chunkType"] {
  const normalizedAssetPath = normalizeAssetLookupText(match.assetPath)
  if (
    normalizedAssetPath?.startsWith("images/") ||
    isImageAssetUrl(match.assetUrl)
  ) {
    return "image"
  }
  if (normalizedAssetPath?.startsWith("tables/")) {
    return "table"
  }
  return fallback
}

function isAssetFilePath(value: string): boolean {
  const normalizedPath = normalizeAssetLookupText(value)
  return normalizedPath ? /^(images|tables)\//.test(normalizedPath) : false
}

function resolveAssetReferenceMatches(
  result: RetrievalResult,
  assetUrlsByFilePath: Readonly<Record<string, string>>,
): readonly AssetReferenceMatch[] {
  const normalizedHaystacks = [
    result.source.sectionPath,
    result.content,
  ].flatMap((value): string[] => {
    const normalized = normalizeAssetLookupText(value)
    return normalized ? [normalized] : []
  })
  if (normalizedHaystacks.length === 0) return []

  return resolveAssetReferenceMatchesFromHaystacks(
    normalizedHaystacks,
    assetUrlsByFilePath,
  )
}

function resolveAssetReferenceMatchesFromText(
  value: string | null | undefined,
  assetUrlsByFilePath: Readonly<Record<string, string>>,
): readonly AssetReferenceMatch[] {
  const normalized = normalizeAssetLookupText(value)
  if (!normalized) return []

  return resolveAssetReferenceMatchesFromHaystacks(
    [normalized],
    assetUrlsByFilePath,
  )
}

export function resolveAssetUrlFromReferenceText(input: {
  readonly values: readonly (string | null | undefined)[]
  readonly assetUrlsByFilePath: Readonly<Record<string, string>>
}): string | null {
  const normalizedHaystacks = input.values.flatMap((value): string[] => {
    const normalized = normalizeAssetLookupText(value)
    return normalized ? [normalized] : []
  })
  if (normalizedHaystacks.length === 0) return null

  const [match] = resolveAssetReferenceMatchesFromHaystacks(
    normalizedHaystacks,
    input.assetUrlsByFilePath,
  )
  return match?.assetUrl ?? null
}

function resolveAssetReferenceMatchesFromHaystacks(
  normalizedHaystacks: readonly string[],
  assetUrlsByFilePath: Readonly<Record<string, string>>,
): readonly AssetReferenceMatch[] {
  const basenameCounts = getNormalizedBasenameCounts(assetUrlsByFilePath)
  return Object.entries(assetUrlsByFilePath)
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

function getAssetUrlTextVariants(assetUrl: string): string[] {
  return Array.from(new Set([assetUrl, decodeUrlText(assetUrl)]))
}

function removeAssetUrlFromAnswer(answer: string, assetUrl: string): string {
  const escapedAssetUrl = escapeRegExp(assetUrl)
  return answer
    .replace(
      new RegExp(`\\[([^\\]]+)\\]\\(\\s*${escapedAssetUrl}\\s*\\)`, "g"),
      "$1",
    )
    .replace(new RegExp(`<\\s*${escapedAssetUrl}\\s*>`, "g"), "")
    .replace(new RegExp(escapedAssetUrl, "g"), "")
}

function removeInternalMetadataJsonBlocks(answer: string): string {
  let output = ""
  let index = 0

  while (index < answer.length) {
    if (answer[index] !== "{") {
      output += answer[index]
      index += 1
      continue
    }

    const objectEndIndex = findJsonObjectEndIndex(answer, index)
    if (objectEndIndex === null) {
      output += answer[index]
      index += 1
      continue
    }

    const objectText = answer.slice(index, objectEndIndex + 1)
    if (isInternalMetadataJsonObject(objectText)) {
      index = objectEndIndex + 1
      continue
    }

    output += objectText
    index = objectEndIndex + 1
  }

  return output
}

function findJsonObjectEndIndex(value: string, startIndex: number): number | null {
  let depth = 0
  let isInsideString = false
  let isEscaped = false

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]
    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (char === "\\") {
        isEscaped = true
        continue
      }
      if (char === "\"") {
        isInsideString = false
      }
      continue
    }

    if (char === "\"") {
      isInsideString = true
      continue
    }
    if (char === "{") {
      depth += 1
      continue
    }
    if (char === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return null
}

function isInternalMetadataJsonObject(value: string): boolean {
  try {
    return hasInternalMetadataKey(JSON.parse(value))
  } catch {
    return false
  }
}

function hasInternalMetadataKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) return value.some(hasInternalMetadataKey)

  return Object.entries(value).some(
    ([key, nestedValue]): boolean =>
      internalMetadataKeys.has(key) || hasInternalMetadataKey(nestedValue),
  )
}

function cleanSanitizedAnswer(answer: string): string {
  const cleanedAnswer = answer
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s*[:：]\s*$/u, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return cleanedAnswer || "I found the relevant media asset in the sources."
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
