import { Effect } from "effect"
import type { DocumentChunk } from "@ontos-ai/knowhere-sdk"

import { parsedChunkNormalization } from "./normalization"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"

const documentChunkPageSize = 200
const defaultChunkPageSize = 50
const maximumChunkPageSize = 200

export type ChunkKnowhereClient = {
  documents: {
    listChunks(
      documentId: string,
      params: {
        page: number
        pageSize: number
        includeAssetUrls: boolean
      },
    ): Promise<{
      documentId?: string
      namespace?: string
      jobId?: string | null
      jobResultId?: string | null
      chunks: DocumentChunk[]
      pagination?: {
        page?: number
        pageSize?: number
        total?: number
        totalPages?: number
      }
    }>
    getChunk?(
      documentId: string,
      chunkId: string,
      params?: { includeAssetUrls?: boolean },
    ): Promise<{
      chunk: DocumentChunk & { assetUrl?: string | null }
    }>
  }
}

export type LoadChunksOptions = {
  assetUrlsByFilePath?: Readonly<Record<string, string>>
}

export type ChunkPageParams = {
  page: number
  pageSize: number
}

export type ChunkPagePagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type ChunkPage = {
  chunks: ParsedChunkView[]
  pagination: ChunkPagePagination
}

export function getChunkPageParams(
  searchParams: URLSearchParams,
): ChunkPageParams {
  return {
    page: normalizePositiveInteger(searchParams.get("page"), 1),
    pageSize: normalizePageSize(
      normalizePositiveInteger(
        searchParams.get("pageSize"),
        defaultChunkPageSize,
      ),
    ),
  }
}

export const loadChunksForSource = (
  source: Source,
  client: ChunkKnowhereClient,
  options: LoadChunksOptions = {},
) =>
  Effect.gen(function* () {
    if (source.status !== "ready" || !source.knowhereDocumentId) return []

    const chunks: DocumentChunk[] = []
    let page = 1
    let totalPages = 1

    do {
      const response = yield* Effect.promise(() =>
        client.documents.listChunks(source.knowhereDocumentId!, {
          page,
          pageSize: documentChunkPageSize,
          includeAssetUrls: true,
        }),
      )

      chunks.push(...response.chunks)
      totalPages = getTotalPages(response.pagination)
      page += 1
    } while (page <= totalPages)

    return resolveChunkConnectionTargets(chunks.map((chunk) =>
      toParsedChunkView(
        chunk,
        source.title,
        source.knowhereDocumentId ?? undefined,
        options,
      ),
    ))
  })

export const loadChunkPageForSource = (
  source: Source,
  client: ChunkKnowhereClient,
  params: ChunkPageParams,
  options: LoadChunksOptions = {},
) =>
  Effect.gen(function* () {
    if (source.status !== "ready" || !source.knowhereDocumentId) {
      return {
        chunks: [],
        pagination: {
          page: params.page,
          pageSize: params.pageSize,
          total: 0,
          totalPages: 0,
        },
      }
    }

    const response = yield* Effect.promise(() =>
      client.documents.listChunks(source.knowhereDocumentId!, {
        page: params.page,
        pageSize: params.pageSize,
        includeAssetUrls: true,
      }),
    )
    const chunks = response.chunks.map((chunk) =>
      toParsedChunkView(
        chunk,
        source.title,
        source.knowhereDocumentId ?? undefined,
        options,
      ),
    )

    return {
      chunks,
      pagination: normalizeChunkPagination(
        response.pagination,
        params,
        chunks.length,
      ),
    }
  })

export function toParsedChunkView(
  chunk: DocumentChunk,
  sourceTitle: string,
  documentId?: string,
  options: LoadChunksOptions = {},
): ParsedChunkView {
  return parsedChunkNormalization.createParsedChunkView({
    chunkId: chunk.id,
    documentId,
    parserChunkId: chunk.chunkId,
    sectionPath: chunk.sectionPath,
    chunkType: chunk.chunkType,
    contentSource:
      (chunk as DocumentChunk & { readonly contentSource?: unknown }).contentSource ??
      (chunk as DocumentChunk & { readonly content_source?: unknown }).content_source,
    content: chunk.content,
    metadata: chunk.metadata,
    filePathCandidates: [
      chunk.filePath,
      chunk.metadata["filePath"],
      chunk.metadata["file_path"],
    ],
    assetUrl: chunk.assetUrl,
    assetUrlsByFilePath: options.assetUrlsByFilePath,
    sourceTitle,
  })
}

export function resolveCitationChunk(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): ParsedChunkView | null {
  return parsedChunkNormalization.resolveCitationChunk(citation, chunks)
}

export function resolveCitationChunkByContent(
  citation: ChatCitationView,
  chunks: readonly ParsedChunkView[],
): ParsedChunkView | null {
  return parsedChunkNormalization.resolveCitationChunkByContent(citation, chunks)
}

function getTotalPages(
  pagination:
    | {
        totalPages?: number
      }
    | undefined,
): number {
  const totalPages = pagination?.totalPages
  return typeof totalPages === "number" && Number.isFinite(totalPages)
    ? Math.max(1, totalPages)
    : 1
}

export function resolveChunkConnectionTargets(
  chunks: ParsedChunkView[],
): ParsedChunkView[] {
  return parsedChunkNormalization.resolveConnectionTargets(chunks)
}

function normalizeChunkPagination(
  pagination:
    | {
        page?: number
        pageSize?: number
        total?: number
        totalPages?: number
      }
    | undefined,
  fallback: ChunkPageParams,
  chunkCount: number,
): ChunkPagePagination {
  const total = getFinitePositiveNumber(pagination?.total, chunkCount)
  return {
    page: getFinitePositiveNumber(pagination?.page, fallback.page),
    pageSize: getFinitePositiveNumber(pagination?.pageSize, fallback.pageSize),
    total,
    totalPages: getFinitePositiveNumber(
      pagination?.totalPages,
      Math.ceil(total / fallback.pageSize),
    ),
  }
}

function normalizePageSize(value: number): number {
  return Math.min(Math.max(value, 1), maximumChunkPageSize)
}

function normalizePositiveInteger(
  value: string | null,
  fallback: number,
): number {
  if (!value) return fallback

  const parsedValue = Number.parseInt(value, 10)
  if (!Number.isFinite(parsedValue) || parsedValue < 1) return fallback
  return parsedValue
}

function getFinitePositiveNumber(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}
