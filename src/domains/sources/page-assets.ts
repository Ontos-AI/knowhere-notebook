import "server-only"

import type { Knowledge } from "@ontos-ai/knowhere-sdk"

import type { ChunkPageParams } from "@/domains/chunks"
import type { SourcePageAssetView } from "./route-types"

type ReadableSource = {
  readonly documentId: string
  readonly revisionKey?: string | null
}

export type SourcePageAssetsPage = {
  readonly pages: readonly SourcePageAssetView[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly totalPages: number
  }
}

export async function readSourcePageAssets(input: {
  readonly knowledge: Knowledge
  readonly source: ReadableSource
  readonly params: ChunkPageParams
}): Promise<SourcePageAssetsPage> {
  const response = await input.knowledge.readChunks({
    documentId: input.source.documentId,
    ...(input.source.revisionKey ? { revisionKey: input.source.revisionKey } : {}),
    chunkType: "page",
    page: input.params.page,
    pageSize: input.params.pageSize,
    assetUrlPolicy: "durable",
  })
  const pages = response.chunks.flatMap((chunk): SourcePageAssetView[] =>
    readPageAssetViews(chunk.metadata.pageAssets, chunk.assetUrl),
  )

  return {
    pages,
    pagination: {
      page: response.page ?? input.params.page,
      pageSize: response.pageSize ?? input.params.pageSize,
      total: response.totalChunks ?? pages.length,
      totalPages:
        response.totalPages ??
        Math.max(1, Math.ceil(pages.length / input.params.pageSize)),
    },
  }
}

function readPageAssetViews(
  value: unknown,
  fallbackAssetUrl?: string,
): SourcePageAssetView[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): SourcePageAssetView[] => {
    if (!isRecord(item)) return []
    const pageNumber = getPositiveInteger(item.pageNum)
    const assetUrl = getTrimmedString(item.assetUrl) ?? fallbackAssetUrl
    const contentType = getTrimmedString(item.contentType)
    if (!pageNumber || !assetUrl || !contentType) return []

    return [
      {
        pageNumber,
        assetUrl,
        contentType,
        ...(getPositiveNumber(item.width) !== undefined
          ? { width: getPositiveNumber(item.width) }
          : {}),
        ...(getPositiveNumber(item.height) !== undefined
          ? { height: getPositiveNumber(item.height) }
          : {}),
      },
    ]
  })
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : undefined
}

function getPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
