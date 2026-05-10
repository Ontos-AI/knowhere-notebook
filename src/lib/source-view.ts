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
  const originalFile = source.originalBlobUrl
    ? {
        url: source.originalBlobUrl,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
      }
    : undefined

  const view: SourceView = {
    id: source.id,
    title: source.title,
    mimeType: source.mimeType,
    status: toSourceStatus(source.status),
    documentId: source.knowhereDocumentId ?? undefined,
  };

  if (originalFile) {
    view.originalFile = originalFile;
  }

  if (options.chunkCount !== undefined) {
    view.chunkCount = options.chunkCount;
  }

  return view;
}

function toSourceStatus(status: string): SourceView["status"] {
  const result = Schema.decodeUnknownEither(SourceStatus)(status)
  if (result._tag === "Right") return result.right
  return "failed"
}
