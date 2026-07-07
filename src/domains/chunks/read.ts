import "server-only"

import type {
  DocumentChunk,
  Knowledge,
  KnowledgeReadChunk,
  KnowledgeReadResponse,
} from "@ontos-ai/knowhere-sdk"

import {
  toParsedChunkView,
  toParsedChunkViewFromReadChunk,
  type ChunkPage,
  type ChunkPageParams,
} from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"

const loadAllPageSize = 200

type DisplayReadChunkType = "text" | "image" | "table" | "page"

type ReadableSource = {
  readonly documentId: string
  readonly title: string
  readonly revisionKey?: string | null
}

type DisplayReadClient = {
  readonly documents: {
    listChunks(
      documentId: string,
      params: {
        readonly page: number
        readonly pageSize: number
        readonly chunkType?: DisplayReadChunkType
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

/**
 * Read a single display page of parsed chunks through the SDK. The SDK serves
 * from configured Blob storage when fresh and falls back to Knowhere remote.
 * If the probe falls through to remote without asset URLs, fetch the same page
 * from Knowhere with short-lived asset URLs instead of hardening assets into
 * Notebook storage.
 */
export async function readSourceChunkPage(input: {
  readonly client: DisplayReadClient
  readonly knowledge: Knowledge
  readonly source: ReadableSource
  readonly params: ChunkPageParams
}): Promise<ChunkPage> {
  const response = await input.knowledge.readChunks({
    documentId: input.source.documentId,
    ...(input.source.revisionKey ? { revisionKey: input.source.revisionKey } : {}),
    page: input.params.page,
    pageSize: input.params.pageSize,
  })

  if (shouldUseKnowledgeChunkResponse(response)) {
    return toChunkPageFromKnowledgeResponse(response, input.source, input.params)
  }

  const remoteResponse = await input.client.documents.listChunks(
    input.source.documentId,
    {
      page: input.params.page,
      pageSize: input.params.pageSize,
      includeAssetUrls: true,
    },
  )
  const chunks = remoteResponse.chunks.map((chunk) =>
    toParsedChunkView(
      chunk,
      input.source.title,
      input.source.documentId,
    ),
  )

  return {
    chunks,
    pagination: {
      page: remoteResponse.pagination?.page ?? input.params.page,
      pageSize: remoteResponse.pagination?.pageSize ?? input.params.pageSize,
      total: remoteResponse.pagination?.total ?? chunks.length,
      totalPages:
        remoteResponse.pagination?.totalPages ??
        Math.max(1, Math.ceil(chunks.length / input.params.pageSize)),
    },
  }
}

function toChunkPageFromKnowledgeResponse(
  response: KnowledgeReadResponse,
  source: ReadableSource,
  params: ChunkPageParams,
): ChunkPage {
  const chunks = response.chunks.map((chunk) =>
    toParsedChunkViewFromReadChunk(chunk, source.title, source.documentId),
  )

  return {
    chunks,
    pagination: {
      page: response.page ?? params.page,
      pageSize: response.pageSize ?? params.pageSize,
      total: response.totalChunks ?? chunks.length,
      totalPages:
        response.totalPages ??
        Math.max(1, Math.ceil(chunks.length / params.pageSize)),
    },
  }
}

/**
 * Read every parsed chunk for a source by paging the SDK to exhaustion. Used by
 * the tree view and load-all display mode.
 */
export async function readAllSourceChunks(input: {
  readonly client: DisplayReadClient
  readonly knowledge: Knowledge
  readonly source: ReadableSource
}): Promise<ParsedChunkView[]> {
  const chunks: ParsedChunkView[] = []
  let page = 1
  let totalPages = 1

  do {
    const response = await input.knowledge.readChunks({
      documentId: input.source.documentId,
      ...(input.source.revisionKey
        ? { revisionKey: input.source.revisionKey }
        : {}),
      page,
      pageSize: loadAllPageSize,
    })
    if (shouldUseKnowledgeChunkResponse(response)) {
      for (const chunk of response.chunks) {
        chunks.push(
          toParsedChunkViewFromReadChunk(
            chunk,
            input.source.title,
            input.source.documentId,
          ),
        )
      }
      totalPages = Math.max(1, response.totalPages ?? 1)
      page += 1
      continue
    }

    const remoteResponse = await input.client.documents.listChunks(
      input.source.documentId,
      {
        page,
        pageSize: loadAllPageSize,
        includeAssetUrls: true,
      },
    )
    for (const chunk of remoteResponse.chunks) {
      chunks.push(
        toParsedChunkView(
          chunk,
          input.source.title,
          input.source.documentId,
        ),
      )
    }
    totalPages = Math.max(1, remoteResponse.pagination?.totalPages ?? 1)
    page += 1
  } while (page <= totalPages)

  return chunks
}

function shouldUseKnowledgeChunkResponse(
  response: KnowledgeReadResponse,
): boolean {
  return isParsedStorageReadResponse(response) || hasUsableReadChunkAssetUrl(response.chunks)
}

function isParsedStorageReadResponse(response: KnowledgeReadResponse): boolean {
  const resultDirectoryPath = response.document.resultDirectoryPath
  return (
    typeof resultDirectoryPath === "string" &&
    resultDirectoryPath.startsWith("parsed-storage:")
  )
}

function hasUsableReadChunkAssetUrl(
  chunks: readonly KnowledgeReadChunk[],
): boolean {
  return chunks.some(
    (chunk) =>
      hasNonEmptyString(chunk.assetUrl) ||
      hasMetadataPageAssetUrl(chunk.metadata),
  )
}

function hasMetadataPageAssetUrl(
  metadata: Readonly<Record<string, unknown>>,
): boolean {
  const value = metadata.pageAssets
  if (!Array.isArray(value)) return false

  return value.some(
    (item) => isRecord(item) && hasNonEmptyString(item.assetUrl),
  )
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
