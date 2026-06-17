import { Schema } from "effect";

import type { Source } from "@/infrastructure/db/schema";
import type { SourceView } from "@/domains/sources/types";

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
        ...(source.demoKey ? { canDownload: false } : {}),
      }
    : undefined

  return {
    id: source.id,
    kind: "workspace",
    title: source.title,
    mimeType: source.mimeType,
    status: toSourceStatus(source.status),
    ...(source.demoKey ? { demoSourceId: source.demoKey } : {}),
    documentId: source.knowhereDocumentId ?? undefined,
    ...(originalFile ? { originalFile } : {}),
    ...(options.chunkCount !== undefined
      ? { chunkCount: options.chunkCount }
      : {}),
  };
}

function toSourceStatus(status: string): SourceView["status"] {
  const result = Schema.decodeUnknownEither(SourceStatus)(status)
  if (result._tag === "Right") return result.right
  return "failed"
}
