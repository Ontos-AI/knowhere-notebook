import DOMPurify from "dompurify"

import { chunksPanelState } from "@/components/chunks-panel-state"
import type {
  ParsedChunkConnection,
  ParsedChunkView,
} from "@/domains/chunks/types"

type ChunkSourceMetadata = {
  readonly pageLabel: string | null
  readonly sectionLabel: string | null
  readonly typeLabel: string
}

type TextChunkContentPart =
  | {
      readonly type: "text"
      readonly text: string
    }
  | {
      readonly type: "reference"
      readonly key: string
      readonly label: string
      readonly targetChunkId: string | null
      readonly isResolved: boolean
      readonly connection: ParsedChunkConnection
    }

type ParsedChunkCardModelModule = {
  readonly getChunkTypeLabel: (type: ParsedChunkView["type"]) => string
  readonly getFocusCardClasses: (isFocused: boolean) => string
  readonly getSanitizedTableHtml: (content: string) => string | null
  readonly getSourceMetadata: (chunk: ParsedChunkView) => ChunkSourceMetadata
  readonly getTextContentParts: (
    chunk: ParsedChunkView,
  ) => readonly TextChunkContentPart[]
}

const tableAllowedTags = [
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
] as const

const tableAllowedAttributes = [
  "colspan",
  "rowspan",
  "scope",
  "align",
] as const

function getSourceMetadata(chunk: ParsedChunkView): ChunkSourceMetadata {
  return {
    pageLabel: formatPageNumbers(chunk.pageNums),
    sectionLabel: chunksPanelState.formatChunkSectionPath(chunk.sectionPath),
    typeLabel: getChunkTypeLabel(chunk.type),
  }
}

function getTextContentParts(
  chunk: ParsedChunkView,
): readonly TextChunkContentPart[] {
  const references = chunksPanelState.getRenderableReferences(chunk)
  if (references.length === 0) return [{ type: "text", text: chunk.content }]

  const parts: TextChunkContentPart[] = []
  let cursor = 0

  references.forEach((reference, index) => {
    if (reference.start > cursor) {
      parts.push({
        type: "text",
        text: chunk.content.slice(cursor, reference.start),
      })
    }

    const targetChunkId = reference.connection.targetChunkId ?? null
    parts.push({
      type: "reference",
      key: `${reference.connection.ref ?? "ref"}-${index}`,
      label: chunksPanelState.getReferenceLabel(reference.connection),
      targetChunkId,
      isResolved: targetChunkId !== null,
      connection: reference.connection,
    })
    cursor = reference.end
  })

  if (cursor < chunk.content.length) {
    parts.push({ type: "text", text: chunk.content.slice(cursor) })
  }

  return parts
}

function getSanitizedTableHtml(content: string): string | null {
  if (!content.trim().startsWith("<")) return null

  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [...tableAllowedTags],
    ALLOWED_ATTR: [...tableAllowedAttributes],
  })
}

function getFocusCardClasses(isFocused: boolean): string {
  return isFocused
    ? "citation-card-highlight border-primary/70 bg-primary/5 ring-2 ring-primary/30 shadow-md"
    : "hover:border-primary/30"
}

function getChunkTypeLabel(type: ParsedChunkView["type"]): string {
  if (type === "image") return "Image"
  if (type === "table") return "Table"
  return "Text"
}

function formatPageNumbers(
  pageNums: ParsedChunkView["pageNums"],
): string | null {
  if (!pageNums || pageNums.length === 0) return null

  const uniquePageNums = Array.from(new Set(pageNums)).sort(
    (leftPageNum, rightPageNum) => leftPageNum - rightPageNum,
  )
  if (uniquePageNums.length === 1) return `Page ${uniquePageNums[0]}`

  const visiblePageNums = uniquePageNums.slice(0, 3).join(", ")
  const suffix = uniquePageNums.length > 3 ? "..." : ""
  return `Pages ${visiblePageNums}${suffix}`
}

export const parsedChunkCardModel: ParsedChunkCardModelModule = {
  getChunkTypeLabel,
  getFocusCardClasses,
  getSanitizedTableHtml,
  getSourceMetadata,
  getTextContentParts,
}
