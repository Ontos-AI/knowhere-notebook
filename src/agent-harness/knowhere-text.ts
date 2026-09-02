import type {
  KnowledgeGrepResponse,
  KnowledgeOutline,
  KnowledgeReadResponse,
  RetrievalQueryResponse,
} from "@ontos-ai/knowhere-sdk"

import type {
  EvidenceAsset,
  EvidenceChunk,
  KnowhereListDocumentsResponse,
} from "./types"

type EvidenceDelta = {
  readonly chunks: readonly EvidenceChunk[]
  readonly assets: readonly EvidenceAsset[]
}

type SearchTextInput = EvidenceDelta & {
  readonly response: RetrievalQueryResponse
  readonly retrievalCount: number
}

type ReadChunksTextInput = EvidenceDelta & {
  readonly response: KnowledgeReadResponse
}

type GrepChunksTextInput = EvidenceDelta & {
  readonly response: KnowledgeGrepResponse
}

type ErrorTextInput = {
  readonly operation: KnowhereOperation
  readonly message: string
}

type KnowhereOperation =
  | "search"
  | "list_documents"
  | "get_document_outline"
  | "read_chunks"
  | "grep_chunks"

const assetInstruction =
  "Notebook returned image/page asset refs. Call inspectImage with the asset refs you will cite before finalize so OCR/visual context and provenance boxes exist. Do not expose raw asset URLs."

export const knowhereToolText = {
  formatSearch(input: SearchTextInput): string {
    return wrapKnowhereBlock("search", [
      formatTag("summary", {
        retrievalCount: String(input.retrievalCount),
        namespace: input.response.namespace,
        query: input.response.query,
        resultCount: String(input.response.results.length),
        referencedChunkCount: String(input.response.referencedChunks.length),
        stopReason: input.response.stopReason ?? undefined,
        failureReason: input.response.failureReason ?? undefined,
      }),
      // Model grounding comes from <chunks> (results). Do not also inject
      // evidenceText — same bodies, no citeable refs, doubles context.
      formatEvidenceChunks(input.chunks),
      formatEvidenceAssets(input.assets),
      formatAssetInstruction(input.assets),
    ])
  },

  formatListDocuments(response: KnowhereListDocumentsResponse): string {
    return wrapKnowhereBlock("list_documents", [
      formatTag("summary", { documentCount: String(response.documents.length) }),
      ...response.documents.map((document, index) =>
        formatSelfClosingTag("document", {
          index: String(index + 1),
          documentId: document.documentId,
          localDocumentId: document.localDocumentId,
          revisionKey: document.revisionKey,
          namespace: document.namespace,
          sourceFileName: document.sourceFileName,
          title: document.title,
          status: document.status,
          chunkCount:
            typeof document.chunkCount === "number"
              ? String(document.chunkCount)
              : undefined,
        }),
      ),
    ])
  },

  formatOutline(response: KnowledgeOutline): string {
    return wrapKnowhereBlock("get_document_outline", [
      formatTag("document", {
        documentId: response.document.documentId,
        localDocumentId: response.document.localDocumentId,
        revisionKey: response.document.jobId,
        sourceFileName: response.document.sourceFileName,
        totalChunks: String(response.totalChunks),
        truncated: response.truncated === true ? "true" : undefined,
        continuationCursor: response.continuationCursor,
      }),
      ...response.sections.map((section) => formatSection(section, 0)),
    ])
  },

  formatReadChunks(input: ReadChunksTextInput): string {
    return wrapKnowhereBlock("read_chunks", [
      formatTag("document", {
        documentId: input.response.document.documentId,
        localDocumentId: input.response.document.localDocumentId,
        revisionKey: input.response.document.jobId,
        sourceFileName: input.response.document.sourceFileName,
        page:
          typeof input.response.page === "number"
            ? String(input.response.page)
            : undefined,
        pageSize:
          typeof input.response.pageSize === "number"
            ? String(input.response.pageSize)
            : undefined,
        totalChunks:
          typeof input.response.totalChunks === "number"
            ? String(input.response.totalChunks)
            : undefined,
        totalPages:
          typeof input.response.totalPages === "number"
            ? String(input.response.totalPages)
            : undefined,
        nextChunk:
          typeof input.response.nextChunk === "number"
            ? String(input.response.nextChunk)
            : undefined,
      }),
      formatEvidenceChunks(input.chunks),
      formatEvidenceAssets(input.assets),
      formatAssetInstruction(input.assets),
    ])
  },

  formatGrepChunks(input: GrepChunksTextInput): string {
    return wrapKnowhereBlock("grep_chunks", [
      formatTag("document", {
        documentId: input.response.document.documentId,
        localDocumentId: input.response.document.localDocumentId,
        revisionKey: input.response.document.jobId,
        sourceFileName: input.response.document.sourceFileName,
        matchCount: String(input.response.matches.length),
        scannedChunks: String(input.response.scannedChunks),
        truncated: input.response.truncated ? "true" : "false",
        continuationCursor: input.response.continuationCursor,
      }),
      formatEvidenceChunks(input.chunks),
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

function formatEvidenceChunks(chunks: readonly EvidenceChunk[]): string {
  if (chunks.length === 0) return ""

  return [
    "<chunks>",
    ...chunks.map((chunk) =>
      [
        formatOpenTag("chunk", {
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
          assetRef: chunk.assetRef,
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

function formatAssetInstruction(assets: readonly EvidenceAsset[]): string {
  if (!assets.some((asset) => asset.type === "image")) return ""
  return formatTextTag("asset_instruction", assetInstruction)
}

function formatSection(
  section: KnowledgeOutline["sections"][number],
  depth: number,
): string {
  return [
    formatOpenTag("section", {
      depth: String(depth),
      sectionPath: section.sectionPath,
      sectionTitle: section.sectionTitle,
      sectionLevel: String(section.sectionLevel),
      startChunk:
        typeof section.startChunk === "number"
          ? String(section.startChunk)
          : undefined,
      endChunk:
        typeof section.endChunk === "number"
          ? String(section.endChunk)
          : undefined,
      chunkCount: String(section.chunkCount),
    }),
    formatOptionalTextTag("summary", section.summary),
    ...section.children.map((child) => formatSection(child, depth + 1)),
    "</section>",
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n")
}

function formatOptionalTextTag(
  tagName: string,
  value: string | null | undefined,
): string {
  const trimmedValue = value?.trim()
  return trimmedValue ? formatTextTag(tagName, trimmedValue) : ""
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
