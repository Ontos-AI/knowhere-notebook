import "server-only"

import { Effect } from "effect"
import type Knowhere from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

type CountChunksClient = {
  readonly documents: {
    listChunks(
      documentId: string,
      params: { readonly page: number; readonly pageSize: number },
    ): Promise<{
      readonly pagination?: { readonly total?: number }
    }>
  }
}

export const countChunksBySourceId = (
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
    if (readySources.length === 0) return new Map<string, number>()

    const entries = yield* Effect.all(
      readySources.map((source) =>
        Effect.gen(function* () {
          const total = yield* Effect.tryPromise(() =>
            loadSourceChunkCount(countClient, source.knowhereDocumentId!),
          ).pipe(Effect.catchAll(() => Effect.succeed<number | undefined>(undefined)))
          return [source.id, total] as const
        }),
      ),
      { concurrency: "unbounded" },
    )

    return new Map(
      entries.filter(
        (entry): entry is readonly [string, number] =>
          typeof entry[1] === "number",
      ),
    )
  })

export const sourceViewOptionsBySourceId = (
  sources: readonly Source[],
  client: Knowhere,
) =>
  Effect.gen(function* () {
    const counts = yield* countChunksBySourceId(sources, client)
    return new Map(
      sources.map((source) => [
        source.id,
        { chunkCount: counts.get(source.id) },
      ]),
    )
  })

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
