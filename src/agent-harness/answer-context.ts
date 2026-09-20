import type { ModelMessage } from "ai"

import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

import type {
  EvidenceAsset,
  EvidenceChunk,
  EvidenceLedgerSnapshot,
  MemorySearchItem,
} from "./types"

export type ReadTableHtml = (assetUrl: string) => Promise<string>
export type ReadImage = (assetUrl: string) => Promise<{
  readonly body: Uint8Array
  readonly mediaType: string
}>
type UserContentParts = Exclude<
  Extract<ModelMessage, { role: "user" }>["content"],
  string
>
type ImagePart = {
  readonly type: "image"
  readonly image: Uint8Array
  readonly mediaType: string
}

export async function composeAnswerContext(input: {
  readonly ledger: EvidenceLedgerSnapshot
  readonly memoryItems: readonly MemorySearchItem[]
  readonly memorySearchAttempted?: boolean
  readonly userText: string
  readonly readTableHtml?: ReadTableHtml
  readonly readImage?: ReadImage
}): Promise<ModelMessage> {
  const content: UserContentParts = []
  const retainedPicks = new Set(input.ledger.retainedPicks)
  const assetsByChunkRef = groupAssetsByChunkRef(input.ledger.assets)

  const retainedChunks = input.ledger.chunks.flatMap((chunk, index) => {
    const pick = index + 1
    return retainedPicks.has(pick) ? [{ chunk, pick }] : []
  })

  if (retainedChunks.length === 0 && input.ledger.retrievalCount > 0) {
    appendText(
      content,
      "## Evidence from Knowledge Base\nNo knowledge base results were found for this search. Answer using your own knowledge only, and say so if relevant.",
    )
  }

  if (retainedChunks.length > 0) {
    appendText(content, "## Evidence from Knowledge Base")
    for (const { chunk, pick } of retainedChunks) {
      const assets = assetsByChunkRef.get(chunk.ref) ?? []
      let chunkText = chunk.content
      for (const table of assets.filter((asset) => asset.type === "table")) {
        chunkText = await replaceTableWithHtml({
          chunk: { ...chunk, content: chunkText },
          asset: table,
          readTableHtml: input.readTableHtml,
        })
      }

      await appendChunkEvidence({
        content,
        pick,
        chunk: { ...chunk, content: chunkText },
        assets,
        readImage: input.readImage,
      })
    }
  }

  if (input.memoryItems.length > 0) {
    appendText(content, [
      "## Fluid Memory",
      ...input.memoryItems.map(formatMemoryItem),
    ].join("\n\n"))
  } else if (input.memorySearchAttempted) {
    appendText(
      content,
      "## Fluid Memory\nNo fluid memory results were found for this search.",
    )
  }

  const userText = input.userText.trim()
  if (userText) {
    appendText(content, `## User's Question\n${userText}`)
  }

  return { role: "user", content }
}

async function appendChunkEvidence(input: {
  readonly content: UserContentParts
  readonly pick: number
  readonly chunk: EvidenceChunk
  readonly assets: readonly EvidenceAsset[]
  readonly readImage?: ReadImage
}): Promise<void> {
  const images = input.assets.filter((asset) => asset.type === "image")
  const prefix = [
    formatChunkLabel(input.pick, input.chunk),
    formatTableArtifactRefs(input.assets),
  ]
    .filter((part) => part.length > 0)
    .join("\n")

  if (images.length === 0) {
    appendText(
      input.content,
      [prefix, input.chunk.content.trim()].filter((part) => part.length > 0).join("\n"),
    )
    return
  }

  if (prefix) appendRawText(input.content, `\n\n${prefix}\n`)

  for (const segment of splitChunkTextAtImages(input.chunk, images)) {
    if (segment.type === "text") {
      appendRawText(input.content, segment.text)
      continue
    }

    const image = await tryReadImage(segment.asset, input.readImage)
    if (!image) continue

    appendRawText(input.content, "\n")
    input.content.push(toImagePart(image))
    appendRawText(input.content, "\n")
  }
}

function splitChunkTextAtImages(
  chunk: EvidenceChunk,
  images: readonly EvidenceAsset[],
): Array<
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly asset: EvidenceAsset }
> {
  if (!chunk.content.trim()) {
    return images.map((asset) => ({ type: "image" as const, asset }))
  }

  let remaining = chunk.content
  const unused = [...images]
  const segments: Array<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly asset: EvidenceAsset }
  > = []

  while (unused.length > 0) {
    const match = findEarliestImagePlaceholder(remaining, chunk, unused)
    if (!match) {
      throw new Error(
        `Image placeholder for ${unused[0]?.ref} was not found in its chunk content.`,
      )
    }
    if (match.before.length > 0) {
      segments.push({ type: "text", text: match.before })
    }
    segments.push({ type: "image", asset: match.asset })
    remaining = match.after
    unused.splice(unused.indexOf(match.asset), 1)
  }

  if (remaining.length > 0) {
    segments.push({ type: "text", text: remaining })
  }
  return segments
}

function findEarliestImagePlaceholder(
  text: string,
  chunk: EvidenceChunk,
  images: readonly EvidenceAsset[],
): {
  readonly asset: EvidenceAsset
  readonly before: string
  readonly after: string
} | null {
  let best: {
    readonly asset: EvidenceAsset
    readonly index: number
    readonly length: number
  } | null = null

  for (const asset of images) {
    const match = findFirstPlaceholder(text, chunk, asset, "image")
    if (!match) continue
    if (
      !best ||
      match.index < best.index ||
      (match.index === best.index && match.length > best.length)
    ) {
      best = { asset, ...match }
    }
  }

  if (!best) return null
  return {
    asset: best.asset,
    before: text.slice(0, best.index),
    after: text.slice(best.index + best.length),
  }
}

function groupAssetsByChunkRef(
  assets: readonly EvidenceAsset[],
): Map<string, EvidenceAsset[]> {
  const grouped = new Map<string, EvidenceAsset[]>()
  for (const asset of assets) {
    const chunkAssets = grouped.get(asset.chunkRef) ?? []
    chunkAssets.push(asset)
    grouped.set(asset.chunkRef, chunkAssets)
  }
  return grouped
}

function formatTableArtifactRefs(assets: readonly EvidenceAsset[]): string {
  return assets
    .filter((asset) => asset.type === "table")
    .map((asset) => `[artifact type="${asset.type}" ref="${asset.ref}"]`)
    .join("\n")
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

function appendRawText(content: UserContentParts, text: string): void {
  if (text.length === 0) return
  const previous = content.at(-1)
  if (previous?.type === "text") {
    previous.text += text
    return
  }
  content.push({ type: "text", text })
}

function toImagePart(image: {
  readonly body: Uint8Array
  readonly mediaType: string
}): ImagePart {
  return {
    type: "image",
    image: image.body,
    mediaType: image.mediaType.split(";")[0]?.trim() || "application/octet-stream",
  }
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
    `[memory ref="${item.ref}" kind="${item.kind}"]`,
    item.text.trim(),
  ]
    .filter((part) => part.length > 0)
    .join("\n")
}

async function replaceTableWithHtml(input: {
  readonly chunk: EvidenceChunk
  readonly asset: EvidenceAsset
  readonly readTableHtml?: ReadTableHtml
}): Promise<string> {
  const html = await tryReadTableHtml(input.asset, input.readTableHtml)
  const content = input.chunk.content
  if (!content.trim()) return html ?? ""

  const pattern = placeholderPattern(
    getAssetPlaceholderCandidates(input.chunk, input.asset),
    "table",
  )
  const replaced = content.replace(new RegExp(pattern, "gi"), () => html ?? "")
  if (html !== null && replaced === content) {
    throw new Error(
      `Table placeholder for ${input.asset.ref} was not found in its chunk content.`,
    )
  }
  return replaced
}

async function tryReadTableHtml(
  asset: EvidenceAsset,
  readTableHtml?: ReadTableHtml,
): Promise<string | null> {
  if (!asset.assetUrl) {
    warnUnreachableAsset(asset, "missing signed URL")
    return null
  }
  if (!readTableHtml) {
    throw new Error("No table HTML reader was provided for retained table evidence.")
  }
  try {
    return await readTableHtml(asset.assetUrl)
  } catch (error) {
    warnUnreachableAsset(asset, summarizeUnknownError(error))
    return null
  }
}

async function tryReadImage(
  asset: EvidenceAsset,
  readImage?: ReadImage,
): Promise<{ readonly body: Uint8Array; readonly mediaType: string } | null> {
  if (!asset.assetUrl) {
    warnUnreachableAsset(asset, "missing signed URL")
    return null
  }
  if (!readImage) {
    throw new Error("No image reader was provided for retained image evidence.")
  }
  try {
    return await readImage(asset.assetUrl)
  } catch (error) {
    warnUnreachableAsset(asset, summarizeUnknownError(error))
    return null
  }
}

function warnUnreachableAsset(asset: EvidenceAsset, reason: string): void {
  logger.warn("chat: skipped unreachable evidence asset", {
    type: asset.type,
    ref: asset.ref,
    assetUrl: asset.assetUrl ?? null,
    sourcePath: asset.sourcePath ?? null,
    reason,
  })
}

function findFirstPlaceholder(
  text: string,
  chunk: EvidenceChunk,
  asset: EvidenceAsset,
  kind: "table" | "image",
): { readonly index: number; readonly length: number } | null {
  const pattern = placeholderPattern(getAssetPlaceholderCandidates(chunk, asset), kind)
  if (!pattern) return null
  const match = new RegExp(pattern, "gi").exec(text)
  if (!match) return null
  return { index: match.index, length: match[0].length }
}

function getAssetPlaceholderCandidates(
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

function placeholderPattern(
  candidates: readonly string[],
  kind: "table" | "image",
): string {
  const label = kind === "table" ? "Table" : "Image"
  return candidates
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .map((placeholder) =>
      `\\[(?:${label}\\s*:\\s*)?${placeholder}\\]|${placeholder}`,
    )
    .join("|")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
