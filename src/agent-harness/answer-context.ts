import type { ModelMessage } from "ai"

import type {
  EvidenceAsset,
  EvidenceChunk,
  EvidenceLedgerSnapshot,
  MemorySearchItem,
} from "./types"

export type ReadTableHtml = (assetUrl: string) => Promise<string>
type UserContentParts = Exclude<
  Extract<ModelMessage, { role: "user" }>["content"],
  string
>

export async function composeAnswerContext(input: {
  readonly ledger: EvidenceLedgerSnapshot
  readonly memoryItems: readonly MemorySearchItem[]
  readonly userText: string
  readonly readTableHtml?: ReadTableHtml
}): Promise<ModelMessage> {
  const content: UserContentParts = []
  const retainedPicks = new Set(input.ledger.retainedPicks)
  const assetsByChunkRef = new Map(
    input.ledger.assets.map((asset) => [asset.chunkRef, asset] as const),
  )

  const retainedChunks = input.ledger.chunks.flatMap((chunk, index) => {
    const pick = index + 1
    return retainedPicks.has(pick) ? [{ chunk, pick }] : []
  })

  if (retainedChunks.length > 0) {
    appendText(content, "## Evidence from Knowledge Base")
    for (const { chunk, pick } of retainedChunks) {
      const asset = assetsByChunkRef.get(chunk.ref)
      const chunkText = asset?.type === "table"
        ? await replaceTableWithHtml({
            chunk,
            asset,
            readTableHtml: input.readTableHtml,
          })
        : chunk.content

      appendText(
        content,
        [formatChunkLabel(pick, chunk), chunkText.trim()]
          .filter((part) => part.length > 0)
          .join("\n"),
      )

      if (asset?.type === "image") {
        if (!asset.assetUrl) {
          throw new Error(`Retained image asset ${asset.ref} has no signed URL.`)
        }
        content.push({
          type: "image",
          image: new URL(asset.assetUrl),
        })
      }
    }
  }

  if (input.memoryItems.length > 0) {
    appendText(content, [
      "## Fluid Memory",
      ...input.memoryItems.map(formatMemoryItem),
    ].join("\n\n"))
  }

  const userText = input.userText.trim()
  if (userText) {
    appendText(content, `## User's Question\n${userText}`)
  }

  return { role: "user", content }
}

function appendText(
  content: UserContentParts,
  text: string,
): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const previous = content.at(-1)
  if (previous?.type === "text") {
    previous.text = `${previous.text}\n\n${trimmed}`
    return
  }
  content.push({ type: "text", text: trimmed })
}

function formatChunkLabel(pick: number, chunk: EvidenceChunk): string {
  const location = [chunk.source.sourceFileName, chunk.source.sectionPath]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" › ")
  return location ? `[pick ${pick}] ${location}` : `[pick ${pick}]`
}

function formatMemoryItem(item: MemorySearchItem): string {
  return [
    `[${item.ref}] ${item.kind}`,
    item.abstractL0.trim(),
    item.overviewL1.trim(),
  ]
    .filter((part) => part.length > 0)
    .join("\n")
}

async function replaceTableWithHtml(input: {
  readonly chunk: EvidenceChunk
  readonly asset: EvidenceAsset
  readonly readTableHtml?: ReadTableHtml
}): Promise<string> {
  if (!input.asset.assetUrl) {
    throw new Error(`Retained table asset ${input.asset.ref} has no signed URL.`)
  }
  if (!input.readTableHtml) {
    throw new Error("No table HTML reader was provided for retained table evidence.")
  }

  const html = await input.readTableHtml(input.asset.assetUrl)
  const content = input.chunk.content
  if (!content.trim()) return html

  const placeholders = getTablePlaceholderCandidates(input.chunk, input.asset)
  const placeholderPattern = placeholders
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .map((placeholder) =>
      `\\[(?:Table\\s*:\\s*)?${placeholder}\\]|${placeholder}`,
    )
    .join("|")
  const replaced = content.replace(
    new RegExp(placeholderPattern, "gi"),
    () => html,
  )

  if (replaced === content) {
    throw new Error(
      `Table placeholder for ${input.asset.ref} was not found in its chunk content.`,
    )
  }
  return replaced
}

function getTablePlaceholderCandidates(
  chunk: EvidenceChunk,
  asset: EvidenceAsset,
): string[] {
  const candidates = [
    asset.sourcePath,
    chunk.filePath,
    chunk.sourceChunkPath,
    asset.assetUrl,
  ]
  const unique: string[] = []
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (!trimmed || unique.includes(trimmed)) continue
    unique.push(trimmed)
  }
  return unique
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
