import { Schema } from "effect";

import type { Source } from "@/infrastructure/db/schema";
import type { SourceView } from "@/domains/sources/types";
import { sourceFailureMessage } from "./failure-message";

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
  const originalFile = getSourceOriginalFile(source)
  const status = toSourceStatus(source.status)
  const failureMessage =
    status === "failed"
      ? sourceFailureMessage.fromStoredReason(source.failureReason)
      : undefined

  return {
    id: source.id,
    kind: "workspace",
    title: source.title,
    mimeType: source.mimeType,
    status,
    documentId: source.knowhereDocumentId ?? undefined,
    ...(failureMessage ? { failureMessage } : {}),
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

function getSourceOriginalFile(
  source: Source,
): SourceView["originalFile"] | undefined {
  if (!source.originalBlobUrl) return undefined

  return {
    url: source.originalBlobUrl,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
  };
}
