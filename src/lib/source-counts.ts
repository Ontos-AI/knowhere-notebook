import "server-only";

import { Effect } from "effect";
import { KnowhereClient, knowhereClientLayer } from "./knowhere";
import type { Source } from "./schema";

export async function countChunksBySourceId(
  sources: readonly Source[],
): Promise<Map<string, number>> {
  const readySources = sources.filter(
    (source) => source.status === "ready" && source.knowhereDocumentId,
  );
  if (readySources.length === 0) return new Map();

  const client = await Effect.runPromise(
    KnowhereClient.pipe(Effect.provide(knowhereClientLayer)),
  );
  const entries = await Promise.all(
    readySources.map(async (source) => {
      const documentId = source.knowhereDocumentId;
      if (!documentId) return [source.id, undefined] as const;

      try {
        const response = await client.documents.listChunks(documentId, {
          page: 1,
          pageSize: 1,
        });
        return [source.id, response.pagination.total] as const;
      } catch {
        return [source.id, undefined] as const;
      }
    }),
  );

  return new Map(
    entries.filter(
      (entry): entry is readonly [string, number] =>
        typeof entry[1] === "number",
    ),
  );
}

export async function sourceViewOptionsBySourceId(
  sources: readonly Source[],
): Promise<Map<string, { chunkCount?: number }>> {
  const counts = await countChunksBySourceId(sources);
  return new Map(
    sources.map((source) => [
      source.id,
      {
        chunkCount: counts.get(source.id),
      },
    ]),
  );
}
