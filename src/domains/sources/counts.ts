import "server-only"

import { Effect, Either } from "effect"
import type Knowhere from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"

export const countChunksBySourceId = (
  sources: readonly Source[],
  client: Knowhere,
) =>
  Effect.gen(function* () {
    const readySources = sources.filter(
      (source) =>
        source.status === "ready" &&
        source.knowhereDocumentId,
    )
    if (readySources.length === 0) return new Map<string, number>()

    const entries = yield* Effect.all(
      readySources.map((source) =>
        Effect.gen(function* () {
          const documentId = source.knowhereDocumentId
          if (!documentId) return [source.id, undefined] as const

          const result = yield* Effect.either(
            Effect.tryPromise(() =>
              client.documents.listChunks(documentId, {
                page: 1,
                pageSize: 1,
              }),
            ),
          )

          if (Either.isLeft(result)) return [source.id, undefined] as const

          return [
            source.id,
            result.right.pagination.total,
          ] as const
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
