import "server-only"

import type { Knowledge } from "@ontos-ai/knowhere-sdk"

import { toParsedChunkViewFromReadChunk, type ChunkPage, type ChunkPageParams } from "@/domains/chunks"
import type { ParsedChunkView } from "@/domains/chunks/types"

const loadAllPageSize = 200

type ReadableSource = {
  readonly documentId: string
  readonly title: string
  readonly revisionKey?: string | null
}

/**
 * Read a single display page of parsed chunks through the SDK. The SDK serves
 * from configured Blob storage when fresh and falls back to Knowhere remote
 * otherwise, hardening visible asset URLs into durable Blob URLs
 * (`assetUrlPolicy: "durable"`) and scheduling a background sync on a miss.
 */
export async function readSourceChunkPage(input: {
  readonly knowledge: Knowledge
  readonly source: ReadableSource
  readonly params: ChunkPageParams
}): Promise<ChunkPage> {
  const response = await input.knowledge.readChunks({
    documentId: input.source.documentId,
    ...(input.source.revisionKey ? { revisionKey: input.source.revisionKey } : {}),
    page: input.params.page,
    pageSize: input.params.pageSize,
    assetUrlPolicy: "durable",
  })

  const chunks = response.chunks.map((chunk) =>
    toParsedChunkViewFromReadChunk(chunk, input.source.title, input.source.documentId),
  )

  return {
    chunks,
    pagination: {
      page: response.page ?? input.params.page,
      pageSize: response.pageSize ?? input.params.pageSize,
      total: response.totalChunks ?? chunks.length,
      totalPages:
        response.totalPages ??
        Math.max(1, Math.ceil(chunks.length / input.params.pageSize)),
    },
  }
}

/**
 * Read every parsed chunk for a source by paging the SDK to exhaustion. Used by
 * the tree view and load-all display mode.
 */
export async function readAllSourceChunks(input: {
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
      assetUrlPolicy: "durable",
    })
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
  } while (page <= totalPages)

  return chunks
}

/**
 * Build a `filePath -> durable Blob URL` map for a source by paging durable
 * reads to exhaustion. This is the single asset-hardening path for chat: the
 * SDK writes any missing asset into Blob during the durable read and returns
 * the durable URL, which we index by both the chunk file path and any
 * `metadata.pageAssets[].artifactRef`.
 */
export async function readSourceAssetUrls(input: {
  readonly knowledge: Knowledge
  readonly documentId: string
  readonly revisionKey?: string | null
}): Promise<Readonly<Record<string, string>>> {
  const assetUrlsByFilePath: Record<string, string> = {}
  let page = 1
  let totalPages = 1

  do {
    const response = await input.knowledge.readChunks({
      documentId: input.documentId,
      ...(input.revisionKey ? { revisionKey: input.revisionKey } : {}),
      page,
      pageSize: loadAllPageSize,
      assetUrlPolicy: "durable",
    })
    for (const chunk of response.chunks) {
      if (chunk.filePath && chunk.assetUrl) {
        assetUrlsByFilePath[chunk.filePath] = chunk.assetUrl
      }
      collectPageAssetUrls(chunk.metadata, assetUrlsByFilePath)
    }
    totalPages = Math.max(1, response.totalPages ?? 1)
    page += 1
  } while (page <= totalPages)

  return assetUrlsByFilePath
}

function collectPageAssetUrls(
  metadata: Record<string, unknown>,
  target: Record<string, string>,
): void {
  const pageAssets = metadata["pageAssets"]
  if (!Array.isArray(pageAssets)) return
  for (const pageAsset of pageAssets) {
    if (typeof pageAsset !== "object" || pageAsset === null) continue
    const record = pageAsset as Record<string, unknown>
    const artifactRef = record["artifactRef"]
    const assetUrl = record["assetUrl"]
    if (typeof artifactRef === "string" && typeof assetUrl === "string") {
      target[artifactRef] = assetUrl
    }
  }
}
