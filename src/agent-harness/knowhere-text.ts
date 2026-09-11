import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import type { EvidenceAsset, EvidenceChunk } from "./types"

type EvidenceDelta = {
  readonly chunks: readonly EvidenceChunk[]
  readonly assets: readonly EvidenceAsset[]
}

type SearchTextInput = EvidenceDelta & {
  readonly response: RetrievalQueryResponse
  readonly retrievalCount: number
  readonly chunkPickStart: number
}

type ErrorTextInput = {
  readonly operation: KnowhereOperation
  readonly message: string
}

type KnowhereOperation = "search"

export const knowhereToolText = {
  formatSearch(input: SearchTextInput): string {
    return wrapKnowhereBlock("search", [
      formatTag("summary", {
        retrievalCount: String(input.retrievalCount),
        namespace: input.response.namespace,
        query: input.response.query,
        resultCount: String(input.response.results.length),
        stopReason: input.response.stopReason ?? undefined,
        failureReason: input.response.failureReason ?? undefined,
      }),
      // Model grounding comes from <chunks> (results). Do not also inject
      // evidenceText — same bodies, no citeable refs, doubles context.
      formatEvidenceChunks(input.chunks, input.chunkPickStart),
      formatEvidenceAssets(input.assets),
    ])
  },

  formatError(input: ErrorTextInput): string {
    return [
      formatOpenTag("knowhere", {
        operation: input.operation,
        status: "error",
      }),
      formatTextTag("message", input.message),
      "</knowhere>",
    ].join("\n")
  },
} as const

function wrapKnowhereBlock(
  operation: KnowhereOperation,
  parts: readonly string[],
): string {
  return [
    formatOpenTag("knowhere", { operation, status: "ok" }),
    ...parts.filter((part) => part.trim().length > 0),
    "</knowhere>",
  ].join("\n")
}

function formatEvidenceChunks(
  chunks: readonly EvidenceChunk[],
  chunkPickStart: number,
): string {
  if (chunks.length === 0) return ""

  return [
    "<chunks>",
    ...chunks.map((chunk, index) =>
      [
        formatOpenTag("chunk", {
          pick: String(chunkPickStart + index + 1),
          ref: chunk.ref,
          kind: chunk.kind,
          chunkId: chunk.chunkId,
          chunkType: chunk.chunkType,
          score: chunk.score === null ? undefined : String(chunk.score),
          documentId: chunk.source.documentId ?? undefined,
          sourceFileName: chunk.source.sourceFileName ?? undefined,
          sectionPath: chunk.source.sectionPath ?? undefined,
          sourceChunkPath: chunk.sourceChunkPath ?? undefined,
          filePath: chunk.filePath ?? undefined,
        }),
        formatTextTag("content", chunk.content),
        "</chunk>",
      ].join("\n"),
    ),
    "</chunks>",
  ].join("\n")
}

function formatEvidenceAssets(assets: readonly EvidenceAsset[]): string {
  if (assets.length === 0) return ""

  return [
    "<assets>",
    ...assets.map((asset) =>
      formatSelfClosingTag("asset", {
        ref: asset.ref,
        chunkRef: asset.chunkRef,
        type: asset.type,
        label: asset.label,
        sourcePath: asset.sourcePath,
        documentId: asset.source.documentId ?? undefined,
        sourceFileName: asset.source.sourceFileName ?? undefined,
        sectionPath: asset.source.sectionPath ?? undefined,
      }),
    ),
    "</assets>",
  ].join("\n")
}

function formatTextTag(tagName: string, value: string): string {
  return [`<${tagName}>`, value, `</${tagName}>`].join("\n")
}

function formatTag(
  tagName: string,
  attrs: Readonly<Record<string, string | undefined>>,
): string {
  return `${formatOpenTag(tagName, attrs)}</${tagName}>`
}

function formatSelfClosingTag(
  tagName: string,
  attrs: Readonly<Record<string, string | undefined>>,
): string {
  return `${formatOpenTag(tagName, attrs).slice(0, -1)} />`
}

function formatOpenTag(
  tagName: string,
  attrs: Readonly<Record<string, string | undefined>>,
): string {
  const serializedAttrs = Object.entries(attrs)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ")
  return serializedAttrs ? `<${tagName} ${serializedAttrs}>` : `<${tagName}>`
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
