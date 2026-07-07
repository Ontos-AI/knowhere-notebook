import "server-only"

import { Effect } from "effect"
import type Knowhere from "@ontos-ai/knowhere-sdk"
import type { KnowledgeReadChunk } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type { SourceDocumentPresentation } from "./types"

type PageAssetDocumentPresentation = Extract<
  SourceDocumentPresentation,
  { readonly kind: "page-assets" }
>

type CountChunksClient = {
  readonly documents: {
    listChunks(
      documentId: string,
      params: { readonly page: number; readonly pageSize: number },
    ): Promise<{
      readonly pagination?: { readonly total?: number }
    }>
  }
  readonly knowledge: {
    readChunks(params: {
      readonly documentId: string
      readonly revisionKey?: string
      readonly chunkType: "page"
      readonly page: number
      readonly pageSize: number
      readonly assetUrlPolicy: "durable"
    }): Promise<{
      readonly chunks: readonly KnowledgeReadChunk[]
      readonly totalChunks?: number
    }>
  }
}

export type SourceViewOptions = {
  readonly chunkCount?: number
  readonly documentPresentation?: SourceDocumentPresentation
}

export const sourceViewOptionsBySourceId = (
  sources: readonly Source[],
  client: Knowhere,
) =>
  Effect.gen(function* () {
    const countClient = client as unknown as CountChunksClient
    const readySources = sources.filter(
      (source) =>
        !source.demoKey &&
        source.status === "ready" &&
        source.knowhereDocumentId,
    )
    if (readySources.length === 0) return new Map<string, SourceViewOptions>()

    const entries = yield* Effect.all(
      readySources.map((source) =>
        Effect.gen(function* () {
          const options = yield* Effect.tryPromise(() =>
            loadSourceViewOptions(countClient, source),
          ).pipe(
            Effect.catchAll(() =>
              Effect.sync((): SourceViewOptions | undefined => undefined),
            ),
          )
          return [source.id, options] as const
        }),
      ),
      { concurrency: "unbounded" },
    )

    return new Map(
      entries.filter(
        (entry): entry is readonly [string, SourceViewOptions] =>
          entry[1] !== undefined,
      ),
    )
  })

export const countChunksBySourceId = (
  sources: readonly Source[],
  client: Knowhere,
) =>
  Effect.gen(function* () {
    const sourceOptions = yield* sourceViewOptionsBySourceId(sources, client)
    const countEntries: [string, number][] = []
    for (const [sourceId, options] of sourceOptions.entries()) {
      if (typeof options.chunkCount === "number") {
        countEntries.push([sourceId, options.chunkCount])
      }
    }
    return new Map(countEntries)
  })

async function loadSourceViewOptions(
  client: CountChunksClient,
  source: Source,
): Promise<SourceViewOptions | undefined> {
  const documentId = source.knowhereDocumentId
  if (!documentId) return undefined

  const pagePresentation = await loadPageAssetPresentation(
    client,
    documentId,
    source.knowhereJobId,
  )
  if (pagePresentation) {
    return {
      chunkCount: pagePresentation.pageCount,
      documentPresentation: pagePresentation,
    }
  }

  const chunkCount = await loadSourceChunkCount(client, documentId)
  return typeof chunkCount === "number" ? { chunkCount } : undefined
}

async function loadPageAssetPresentation(
  client: CountChunksClient,
  documentId: string,
  revisionKey: string | null,
): Promise<PageAssetDocumentPresentation | undefined> {
  try {
    const response = await client.knowledge.readChunks({
      documentId,
      ...(revisionKey ? { revisionKey } : {}),
      chunkType: "page",
      page: 1,
      pageSize: 1,
      assetUrlPolicy: "durable",
    })
    const firstChunk = response.chunks[0]
    if (!firstChunk || firstChunk.chunkType !== "page") return undefined
    if (!hasUsablePageAssets(firstChunk.metadata.pageAssets)) return undefined

    const pageCount =
      typeof response.totalChunks === "number" &&
      Number.isFinite(response.totalChunks) &&
      response.totalChunks > 0
        ? response.totalChunks
        : 1

    return { kind: "page-assets", pageCount }
  } catch {
    return undefined
  }
}

async function loadSourceChunkCount(
  client: CountChunksClient,
  documentId: string,
): Promise<number | undefined> {
  const response = await client.documents.listChunks(documentId, {
    page: 1,
    pageSize: 1,
  })
  const total = response.pagination?.total
  return typeof total === "number" && Number.isFinite(total) ? total : undefined
}

function hasUsablePageAssets(value: unknown): boolean {
  if (!Array.isArray(value)) return false

  return value.some((item) => {
    if (!isRecord(item)) return false
    const pageNum = item.pageNum
    const artifactRef = item.artifactRef
    const assetUrl = item.assetUrl
    return (
      typeof pageNum === "number" &&
      Number.isSafeInteger(pageNum) &&
      pageNum > 0 &&
      ((typeof artifactRef === "string" && artifactRef.trim().length > 0) ||
        (typeof assetUrl === "string" && assetUrl.trim().length > 0))
    )
  })
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
