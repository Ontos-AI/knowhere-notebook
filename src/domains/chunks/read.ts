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
 * otherwise. Display reads intentionally do not request durable asset URLs:
 * chat hardens only the specific assets it sends back to the user.
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
