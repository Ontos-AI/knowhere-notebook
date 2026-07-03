import "server-only"

import { createHash } from "node:crypto"
import type {
  KnowhereSdkStorage,
  PageCitationAsset,
  PageCitationAssetCurrentIndex,
  PageCitationAssetIndex,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import { createVercelBlobKnowhereSdkStorage } from "@/integrations/knowhere-sdk-storage"

export type PageCitationAssetRetrievalResult = RetrievalResult & {
  readonly pageCitationAssetUrl?: string
}

type EnrichRetrievalResultsWithPageCitationAssetUrlsInput = {
  readonly results: readonly RetrievalResult[]
  readonly sources: readonly Source[]
  readonly storage?: KnowhereSdkStorage
}

type PageCitationAssetCandidate = {
  readonly pageNum: number
  readonly assetUrl?: string
  readonly key?: string
}

const defaultVariant = "default"

export async function enrichRetrievalResultsWithPageCitationAssetUrls({
  results,
  sources,
  storage = createVercelBlobKnowhereSdkStorage(),
}: EnrichRetrievalResultsWithPageCitationAssetUrlsInput): Promise<
  PageCitationAssetRetrievalResult[]
> {
  if (results.length === 0) return []

  const sourcesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, Source][] =>
      source.knowhereDocumentId ? [[source.knowhereDocumentId, source]] : [],
    ),
  )
  const indexByKey = new Map<string, Promise<PageCitationAssetIndex | null>>()

  return Promise.all(
    results.map((result) =>
      enrichRetrievalResultWithPageCitationAssetUrl({
        result,
        storage,
        source: result.source.documentId
          ? sourcesByDocumentId.get(result.source.documentId)
          : undefined,
        indexByKey,
      }),
    ),
  )
}

async function enrichRetrievalResultWithPageCitationAssetUrl(input: {
  readonly result: RetrievalResult
  readonly source?: Source
  readonly storage: KnowhereSdkStorage
  readonly indexByKey: Map<string, Promise<PageCitationAssetIndex | null>>
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

  if (pageNumbers.length === 0) return input.result

  const documentId = getTrimmedString(input.result.source.documentId)
  if (!documentId) return input.result

  const index = await resolvePageCitationAssetIndex({
    storage: input.storage,
    documentId,
    jobId: getResultJobId(input.result, input.source),
    indexByKey: input.indexByKey,
  })
  if (!index) return input.result

  const asset = index.assets.find((candidate) =>
    pageNumbers.includes(candidate.pageNum),
  )
  if (!asset) return input.result

  const assetUrl =
    getTrimmedString(asset.assetUrl) ??
    (asset.key && input.storage.getObjectUrl
      ? await input.storage.getObjectUrl(asset.key).catch(() => null)
      : null)
  if (!assetUrl) return input.result

  return {
    ...input.result,
    pageCitationAssetUrl: assetUrl,
  }
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
        key: getTrimmedString(item.key) ?? undefined,
      },
    ]
  })
}

async function resolvePageCitationAssetIndex(input: {
  readonly storage: KnowhereSdkStorage
  readonly documentId: string
  readonly jobId: string | null
  readonly indexByKey: Map<string, Promise<PageCitationAssetIndex | null>>
}): Promise<PageCitationAssetIndex | null> {
  if (!input.storage.readObject) return null

  if (input.jobId) {
    const jobIndexKey = createPageCitationAssetIndexKey(
      input.documentId,
      input.jobId,
    )
    const jobIndex = await readCachedIndex(
      input.storage,
      jobIndexKey,
      input.indexByKey,
    )
    if (jobIndex) return jobIndex
  }

  const current = await readCurrentIndexPointer(input.storage, input.documentId)
  if (!current) return null

  return readCachedIndex(input.storage, current.indexKey, input.indexByKey)
}

async function readCachedIndex(
  storage: KnowhereSdkStorage,
  key: string,
  cache: Map<string, Promise<PageCitationAssetIndex | null>>,
): Promise<PageCitationAssetIndex | null> {
  let cached = cache.get(key)
  if (!cached) {
    cached = readPageCitationAssetIndex(storage, key)
    cache.set(key, cached)
  }
  return cached
}

async function readCurrentIndexPointer(
  storage: KnowhereSdkStorage,
  documentId: string,
): Promise<PageCitationAssetCurrentIndex | null> {
  const key = createPageCitationAssetCurrentIndexKey(documentId)
  const parsed = await readJsonObject(storage, key)
  if (!isRecord(parsed)) return null

  const indexKey = getTrimmedString(parsed.indexKey)
  const jobId = getTrimmedString(parsed.jobId)
  const variant = getTrimmedString(parsed.variant)
  if (!indexKey || !jobId || !variant) return null

  return {
    version: 1,
    documentId,
    jobId,
    variant,
    indexKey,
    namespace: getTrimmedString(parsed.namespace) ?? undefined,
    jobResultId: getTrimmedString(parsed.jobResultId) ?? undefined,
    updatedAt: getTrimmedString(parsed.updatedAt) ?? "",
  }
}

async function readPageCitationAssetIndex(
  storage: KnowhereSdkStorage,
  key: string,
): Promise<PageCitationAssetIndex | null> {
  const parsed = await readJsonObject(storage, key)
  if (!isRecord(parsed) || !Array.isArray(parsed.assets)) return null

  const assets = parsed.assets.flatMap((asset): PageCitationAsset[] => {
    if (!isRecord(asset)) return []
    const pageNum = getPositiveInteger(asset.pageNum)
    const keyValue = getTrimmedString(asset.key)
    const mimeType = getPageCitationMimeType(asset.mimeType)
    const width = getPositiveInteger(asset.width)
    const height = getPositiveInteger(asset.height)
    if (!pageNum || !keyValue || !mimeType || !width || !height) return []

    return [
      {
        pageNum,
        key: keyValue,
        assetUrl: getTrimmedString(asset.assetUrl) ?? undefined,
        mimeType,
        width,
        height,
        source: "client-rendered-pdf-page",
        variant: getTrimmedString(asset.variant) ?? defaultVariant,
      },
    ]
  })
  if (assets.length === 0) return null

  return {
    version: 1,
    documentId: getTrimmedString(parsed.documentId) ?? "",
    jobId: getTrimmedString(parsed.jobId) ?? "",
    variant: getTrimmedString(parsed.variant) ?? defaultVariant,
    generatedAt: getTrimmedString(parsed.generatedAt) ?? "",
    namespace: getTrimmedString(parsed.namespace) ?? undefined,
    jobResultId: getTrimmedString(parsed.jobResultId) ?? undefined,
    assets,
  }
}

async function readJsonObject(
  storage: KnowhereSdkStorage,
  key: string,
): Promise<unknown> {
  if (!storage.readObject) return null

  const object = await storage.readObject(key).catch(() => null)
  if (!object) return null

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(object.body))
    return parsed
  } catch {
    return null
  }
}

function getResultJobId(
  result: RetrievalResult,
  source: Source | undefined,
): string | null {
  const metadata = result.metadata
  return (
    getRecordString(metadata, "jobId") ??
    getRecordString(metadata, "job_id") ??
    getTrimmedString(source?.knowhereJobId) ??
    null
  )
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

function createPageCitationAssetIndexKey(
  documentId: string,
  jobId: string,
): string {
  return [
    "page-citation-assets",
    "documents",
    toSafeKeySegment(documentId),
    "jobs",
    toSafeKeySegment(jobId),
    "variants",
    defaultVariant,
    "index.json",
  ].join("/")
}

function createPageCitationAssetCurrentIndexKey(documentId: string): string {
  return [
    "page-citation-assets",
    "documents",
    toSafeKeySegment(documentId),
    "current.json",
  ].join("/")
}

function toSafeKeySegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  if (normalized.length > 0 && normalized === value) return normalized

  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12)
  return `${(normalized || "value").slice(0, 48)}-${hash}`
}

function getPageCitationMimeType(value: unknown): PageCitationAsset["mimeType"] | null {
  return value === "image/png" || value === "image/jpeg" ? value : null
}

function getRecordString(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | null {
  if (!record) return null
  return getTrimmedString(record[key])
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
