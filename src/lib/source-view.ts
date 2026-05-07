import type { Source } from "./schema";
import type { SourceView } from "./types";

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
  if (
    status === "uploading" ||
    status === "parsing" ||
    status === "ready" ||
    status === "failed"
  ) {
    return status;
  }
  return "failed";
}
