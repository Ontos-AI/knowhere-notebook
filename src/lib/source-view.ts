import { Schema } from "effect";

import type { Source } from "./schema";
import type { SourceView } from "./types";

const SourceStatus = Schema.Literal(
  "uploading",
  "parsing",
  "ready",
  "failed",
)

export function toSourceView(
  source: Source,
  options: { chunkCount?: number } = {},
): SourceView {
  return {
    id: source.id,
    title: source.title,
    status: toSourceStatus(source.status),
    documentId: source.knowhereDocumentId ?? undefined,
    chunkCount: options.chunkCount,
  };
}

function toSourceStatus(status: string): SourceView["status"] {
  const result = Schema.decodeUnknownEither(SourceStatus)(status)
  if (result._tag === "Right") return result.right
  return "failed"
}
