import { workspaceCitationState } from "@/components/workspace-citation-state"
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatMessageView,
} from "@/domains/chat/types"

export const knowhereCiteHrefPrefix = "knowhere-cite://"

export type CitationSourceGroupEntry = {
  readonly citation: ChatCitationView
  readonly citationId: string
  readonly citationIndex: number
  readonly chipLabel: string
  readonly pageNumber: number | null
}

export type CitationSourceGroup = {
  readonly key: string
  readonly title: string
  readonly documentId: string | null
  readonly entries: readonly CitationSourceGroupEntry[]
}

export const chatCitationModel = {
  knowhereCiteHrefPrefix,
  embedCitationMarkersAsLinks,
  getCitationChipLabel,
  getCopyMarkdown,
  getExportMarkdown,
  getSourceTitle,
  groupCitationsByFile,
  isKnowhereCiteHref,
  parseKnowhereCiteIndex,
  stripCitationMarkers,
  transformMarkdownUrl,
  uniquePageLinkEntries,
} as const

function embedCitationMarkersAsLinks(
  content: string,
  citations: readonly ChatCitationView[],
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  return mapOutsideCodeFences(content, (text) =>
    collapseRemovedCitationSpace(
      replaceCitationTokens(text, (index) => {
        const citation = citations[index - 1]
        if (!citation) return ""
        return toCiteMarkdownLink(
          getCitationChipLabel(citation, sourceTitlesByDocumentId),
          index,
        )
      }),
    ),
  )
}

function getCopyMarkdown(
  message: ChatMessageView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  const copiedBody = mapOutsideCodeFences(message.content, (text) =>
    collapseRemovedCitationSpace(
      replaceCitationTokens(text, (index) => {
        const citation = message.citations?.[index - 1]
        if (!citation) return ""
        return ` ${getCitationChipLabel(citation, sourceTitlesByDocumentId)}`
      }),
    ),
  )

  return appendDerivedTables(copiedBody, message.artifacts)
}

function getExportMarkdown(message: ChatMessageView): string {
  return appendDerivedTables(stripCitationMarkers(message.content), message.artifacts)
}

function stripCitationMarkers(content: string): string {
  return mapOutsideCodeFences(content, (text) =>
    collapseRemovedCitationSpace(replaceCitationTokens(text, () => "")),
  )
}

function groupCitationsByFile(
  messageId: string,
  citations: readonly ChatCitationView[],
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): readonly CitationSourceGroup[] {
  const groups: CitationSourceGroup[] = []
  const groupIndexByKey = new Map<string, number>()

  for (const [citationIndex, citation] of citations.entries()) {
    const title = getSourceTitle(citation, sourceTitlesByDocumentId)
    const documentId = getTrimmedField(citation.source.documentId)
    const key = documentId
      ? `document:${documentId}`
      : `file:${citationIndex}:${title}`
    const entry: CitationSourceGroupEntry = {
      citation,
      citationId: `${messageId}:${citationIndex}`,
      citationIndex,
      chipLabel: getCitationChipLabel(citation, sourceTitlesByDocumentId),
      pageNumber: workspaceCitationState.getCitationPageNumber(citation),
    }
    const existingIndex = groupIndexByKey.get(key)
    if (existingIndex === undefined) {
      groupIndexByKey.set(key, groups.length)
      groups.push({
        key,
        title,
        documentId,
        entries: [entry],
      })
      continue
    }

    const existing = groups[existingIndex]
    if (!existing) continue
    groups[existingIndex] = {
      ...existing,
      entries: [...existing.entries, entry],
    }
  }

  return groups
}

function uniquePageLinkEntries(
  entries: readonly CitationSourceGroupEntry[],
): readonly CitationSourceGroupEntry[] {
  const seenPageNumbers = new Set<number>()
  const uniqueEntries: CitationSourceGroupEntry[] = []

  for (const entry of entries) {
    if (entry.pageNumber === null || seenPageNumbers.has(entry.pageNumber)) {
      continue
    }
    seenPageNumbers.add(entry.pageNumber)
    uniqueEntries.push(entry)
  }

  return uniqueEntries
}

function getCitationChipLabel(
  citation: ChatCitationView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  const title = getSourceTitle(citation, sourceTitlesByDocumentId)
  const pageNumber = workspaceCitationState.getCitationPageNumber(citation)
  return pageNumber === null ? title : `${title}/p${pageNumber}`
}

function getSourceTitle(
  citation: ChatCitationView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  const documentId = getTrimmedField(citation.source.documentId)
  const sourceTitle = documentId
    ? getTrimmedField(sourceTitlesByDocumentId[documentId])
    : null
  if (sourceTitle) return sourceTitle

  const sourceFileName = getTrimmedField(citation.source.sourceFileName)
  if (sourceFileName && !isGeneratedKnowhereFileName(sourceFileName)) {
    return sourceFileName
  }

  return "Source"
}

function isKnowhereCiteHref(href: string | undefined): boolean {
  return typeof href === "string" && href.startsWith(knowhereCiteHrefPrefix)
}

function parseKnowhereCiteIndex(href: string | undefined): number | null {
  if (!href || !href.startsWith(knowhereCiteHrefPrefix)) return null
  const value = href.slice(knowhereCiteHrefPrefix.length)
  const index = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(index) || index < 1) return null
  return index
}

function transformMarkdownUrl(value: string, transformDefault: (next: string) => string): string {
  if (isKnowhereCiteHref(value)) return value
  return transformDefault(value)
}

function replaceCitationTokens(
  text: string,
  replaceIndex: (index: number) => string,
): string {
  return text
    .replace(/\[\[cite:(\d+)\]\]/g, (_match, rawIndex: string) => {
      const index = Number.parseInt(rawIndex, 10)
      if (!Number.isSafeInteger(index) || index < 1) return ""
      return replaceIndex(index)
    })
    .replace(/\[Source\s+(\d+)\s*:\s*[^\]]*\]/g, (_match, rawIndex: string) => {
      const index = Number.parseInt(rawIndex, 10)
      if (!Number.isSafeInteger(index) || index < 1) return ""
      return replaceIndex(index)
    })
}

function toCiteMarkdownLink(label: string, index: number): string {
  return `[${escapeMarkdownLinkLabel(label)}](${knowhereCiteHrefPrefix}${index})`
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
}

function collapseRemovedCitationSpace(text: string): string {
  return text.replaceAll("  ", " ").replace(/ +([.,;:])/g, "$1").trimEnd()
}

function mapOutsideCodeFences(
  content: string,
  mapText: (text: string) => string,
): string {
  const lines = content.split("\n")
  const output: string[] = []
  let fenceMarker: string | null = null

  for (const line of lines) {
    if (fenceMarker) {
      output.push(line)
      if (line.startsWith(fenceMarker)) fenceMarker = null
      continue
    }

    const fenceMatch = /^(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      fenceMarker = fenceMatch[1] ?? null
      output.push(line)
      continue
    }

    output.push(mapText(line))
  }

  return output.join("\n")
}

function appendDerivedTables(
  markdown: string,
  artifacts: readonly ChatArtifactView[] | undefined,
): string {
  const tables = (artifacts ?? []).flatMap((artifact, index) => {
    if (artifact.display === false || artifact.type !== "derived_table") return []
    if (!artifact.title || !artifact.columns || !artifact.rows) return []
    return [formatDerivedTable(artifact, index)]
  })
  if (tables.length === 0) return markdown
  const body = markdown.trimEnd()
  return body.length > 0 ? `${body}\n\n${tables.join("\n\n")}` : tables.join("\n\n")
}

function formatDerivedTable(
  artifact: ChatArtifactView,
  index: number,
): string {
  const columns = artifact.columns ?? []
  const header = `| ${columns.join(" | ")} |`
  const separator = `| ${columns.map(() => "---").join(" | ")} |`
  const rows = (artifact.rows ?? []).map(
    (row) => `| ${columns.map((_, columnIndex) => row[columnIndex] ?? "").join(" | ")} |`,
  )
  return [`### ${artifact.title ?? `Table ${index + 1}`}`, header, separator, ...rows].join(
    "\n",
  )
}

function getTrimmedField(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function isGeneratedKnowhereFileName(value: string): boolean {
  return /^document-[A-Za-z0-9_-]{16,}\.[A-Za-z0-9]+$/u.test(value)
}
