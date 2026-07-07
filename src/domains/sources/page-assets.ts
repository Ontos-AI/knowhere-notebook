import "server-only"

import type {
  DocumentChunk,
  Knowledge,
  KnowledgeReadResponse,
} from "@ontos-ai/knowhere-sdk"

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

type PageAssetReadClient = {
  readonly documents: {
    listChunks(
      documentId: string,
      params: {
        readonly page: number
        readonly pageSize: number
        readonly chunkType: "page"
        readonly includeAssetUrls: true
      },
    ): Promise<{
      readonly chunks: readonly DocumentChunk[]
      readonly pagination?: {
        readonly page?: number
        readonly pageSize?: number
        readonly total?: number
        readonly totalPages?: number
      }
    }>
  }
}

export async function readSourcePageAssets(input: {
  readonly client: PageAssetReadClient
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
  })

  const knowledgePage = toSourcePageAssetsPageFromKnowledgeResponse(
    response,
    input.params,
  )
  if (
    isParsedStorageReadResponse(response) &&
    knowledgePage.pages.length > 0
  ) {
    return knowledgePage
  }
  if (knowledgePage.pages.length > 0) return knowledgePage

  const remoteResponse = await input.client.documents.listChunks(
    input.source.documentId,
    {
      page: input.params.page,
      pageSize: input.params.pageSize,
      chunkType: "page",
      includeAssetUrls: true,
    },
  )
  return toSourcePageAssetsPageFromRemoteResponse(remoteResponse, input.params)
}

function toSourcePageAssetsPageFromKnowledgeResponse(
  response: KnowledgeReadResponse,
  params: ChunkPageParams,
): SourcePageAssetsPage {
  const pages = response.chunks.flatMap((chunk): SourcePageAssetView[] =>
    readPageAssetViews(chunk.metadata.pageAssets, chunk.assetUrl),
  )
  const maxPageNumber = getMaxPageNumber(pages)
  const total = Math.max(response.totalChunks ?? 0, maxPageNumber ?? 0)
  const resolvedTotal = total > 0 ? total : pages.length
  const computedTotalPages = Math.max(
    1,
    Math.ceil(resolvedTotal / params.pageSize),
  )
  const totalPages = Math.max(response.totalPages ?? 0, computedTotalPages)

  return {
    pages,
    pagination: {
      page: response.page ?? params.page,
      pageSize: response.pageSize ?? params.pageSize,
      total: resolvedTotal,
      totalPages,
    },
  }
}

function toSourcePageAssetsPageFromRemoteResponse(
  response: {
    readonly chunks: readonly DocumentChunk[]
    readonly pagination?: {
      readonly page?: number
      readonly pageSize?: number
      readonly total?: number
      readonly totalPages?: number
    }
  },
  params: ChunkPageParams,
): SourcePageAssetsPage {
  const pages = response.chunks.flatMap((chunk): SourcePageAssetView[] =>
    readPageAssetViews(chunk.metadata.pageAssets, chunk.assetUrl ?? undefined),
  )
  const maxPageNumber = getMaxPageNumber(pages)
  const total = Math.max(response.pagination?.total ?? 0, maxPageNumber ?? 0)
  const resolvedTotal = total > 0 ? total : pages.length
  const computedTotalPages = Math.max(
    1,
    Math.ceil(resolvedTotal / params.pageSize),
  )
  const totalPages = Math.max(
    response.pagination?.totalPages ?? 0,
    computedTotalPages,
  )

  return {
    pages,
    pagination: {
      page: response.pagination?.page ?? params.page,
      pageSize: response.pagination?.pageSize ?? params.pageSize,
      total: resolvedTotal,
      totalPages,
    },
  }
}

function isParsedStorageReadResponse(response: KnowledgeReadResponse): boolean {
  const resultDirectoryPath = response.document.resultDirectoryPath
  return (
    typeof resultDirectoryPath === "string" &&
    resultDirectoryPath.startsWith("parsed-storage:")
  )
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

function getMaxPageNumber(
  pages: readonly SourcePageAssetView[],
): number | undefined {
  if (pages.length === 0) return undefined
  return Math.max(...pages.map((page) => page.pageNumber))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
