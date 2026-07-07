import { Schema } from "effect";

import type { Source } from "@/infrastructure/db/schema";
import type { SourceView } from "@/domains/sources/types";
import { sourceFailureMessage } from "./failure-message";
import type { SourceDocumentPresentation } from "./types";

const SourceStatus = Schema.Literal(
  "uploading",
  "parsing",
  "ready",
  "failed",
)

export function toSourceView(
  source: Source,
  options: {
    readonly chunkCount?: number
    readonly documentPresentation?: SourceDocumentPresentation
  } = {},
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
    ...(source.demoKey ? { demoSourceId: source.demoKey } : {}),
    documentId: source.knowhereDocumentId ?? undefined,
    ...(failureMessage ? { failureMessage } : {}),
    ...(originalFile ? { originalFile } : {}),
    ...(options.chunkCount !== undefined
      ? { chunkCount: options.chunkCount }
      : {}),
    ...(options.documentPresentation !== undefined
      ? { documentPresentation: options.documentPresentation }
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
  if (source.demoKey && !isPublicDemoOriginalUrl(source.originalBlobUrl)) {
    return undefined
  }

  return {
    url: source.originalBlobUrl,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    ...(source.demoKey ? { canDownload: false } : {}),
    ...(source.demoKey ? { pdfPreviewMode: "browser" as const } : {}),
  }
}

function isPublicDemoOriginalUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value)
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return false
    }
    return !isDemoOriginalProxyPath(parsedUrl.pathname)
  } catch {
    return false
  }
}

function isDemoOriginalProxyPath(pathname: string): boolean {
  return (
    /^\/api\/v1\/demo\/sources\/[^/]+\/original\/?$/.test(pathname) ||
    /^\/api\/demo-sources\/[^/]+\/original\/?$/.test(pathname)
  )
}
