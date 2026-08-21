import type {
  KnowledgeGrepMatch,
  KnowledgeGrepResponse,
  KnowledgeReadChunk,
  KnowledgeReadResponse,
  RetrievalQueryResponse,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import type {
  EvidenceAsset,
  EvidenceChunk,
  EvidenceLedgerSnapshot,
} from "./types"

const contentPreviewLimit = 1_200
const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"] as const

type MutableLedger = {
  retrievalCount: number
  readCount: number
  grepCount: number
  chunks: EvidenceChunk[]
  assets: EvidenceAsset[]
  evidenceText: string[]
  stopReasons: string[]
  failureReasons: string[]
  decisionTraces: unknown[]
}

type EvidenceAssetCandidate = {
  readonly type: EvidenceAsset["type"]
  readonly assetUrl?: string
  readonly sourcePath?: string
  readonly label: string
}

type PageCitationAssetCandidate = {
  readonly pageNum: number
  readonly artifactRef?: string
  readonly assetUrl?: string
  readonly contentType?: string
}

export type EvidenceLedger = ReturnType<typeof createEvidenceLedger>

export function createEvidenceLedger() {
  const ledger: MutableLedger = {
    retrievalCount: 0,
    readCount: 0,
    grepCount: 0,
    chunks: [],
    assets: [],
    evidenceText: [],
    stopReasons: [],
    failureReasons: [],
    decisionTraces: [],
  }

  return {
    addRetrievalResponse(response: RetrievalQueryResponse): EvidenceLedgerSnapshot {
      ledger.retrievalCount += 1
      const retrievalIndex = ledger.retrievalCount

      const evidenceText = response.evidenceText?.trim()
      if (evidenceText) ledger.evidenceText.push(evidenceText)

      const stopReason = response.stopReason?.trim()
      if (stopReason) ledger.stopReasons.push(stopReason)

      const failureReason = response.failureReason?.trim()
      if (failureReason) ledger.failureReasons.push(failureReason)

      const decisionTrace = getDecisionTrace(response)
      if (decisionTrace) ledger.decisionTraces.push(decisionTrace)

      response.results.forEach((result, index) => {
        addChunkFromResult({
          ledger,
          result,
          ref: `r${retrievalIndex}:result:${index + 1}`,
          kind: "result",
        })
      })

      response.referencedChunks.forEach((chunk, index) => {
        const content = ""
        addChunk({
          ledger,
          chunk: {
            ref: `r${retrievalIndex}:referenced:${index + 1}`,
            kind: "referenced_chunk",
            chunkId: chunk.chunkId,
            content,
            contentPreview: content,
            chunkType: chunk.chunkType,
            score: null,
            sourceChunkPath: chunk.sourceChunkPath,
            filePath: chunk.filePath,
            metadata: chunk.metadata,
            source: {
              documentId: chunk.documentId,
              sourceFileName: null,
              sectionPath: chunk.sectionPath,
            },
            ...(chunk.jobId ? { revisionKey: chunk.jobId } : {}),
            ...(chunk.assetUrl ? { assetUrl: chunk.assetUrl } : {}),
          },
        })
      })

      return snapshot(ledger)
    },

    addReadChunksResponse(response: KnowledgeReadResponse): EvidenceLedgerSnapshot {
      ledger.readCount += 1
      const readIndex = ledger.readCount

      response.chunks.forEach((chunk, index) => {
        addChunkFromReadChunk({
          ledger,
          response,
          chunk,
          ref: `read${readIndex}:chunk:${index + 1}`,
        })
      })

      return snapshot(ledger)
    },

    addGrepChunksResponse(response: KnowledgeGrepResponse): EvidenceLedgerSnapshot {
      ledger.grepCount += 1
      const grepIndex = ledger.grepCount

      response.matches.forEach((match, index) => {
        addChunkFromGrepMatch({
          ledger,
          response,
          match,
          ref: `grep${grepIndex}:match:${index + 1}`,
        })
      })

      return snapshot(ledger)
    },

    read(ref: string, offset = 0, limit = 4_000) {
      const chunk = ledger.chunks.find((candidate) => candidate.ref === ref)
      if (!chunk) {
        return {
          found: false as const,
          ref,
          contentSlice: "",
          contentLength: 0,
          offset: 0,
          limit,
          hasMoreContent: false,
        }
      }

      const boundedOffset = Math.max(0, Math.min(offset, chunk.content.length))
      const boundedLimit = Math.max(1, limit)
      const end = Math.min(boundedOffset + boundedLimit, chunk.content.length)
      return {
        found: true as const,
        ref,
        chunk,
        contentSlice: chunk.content.slice(boundedOffset, end),
        contentLength: chunk.content.length,
        offset: boundedOffset,
        limit: boundedLimit,
        hasMoreContent: end < chunk.content.length,
      }
    },

    hasEvidence(): boolean {
      return ledger.chunks.length > 0 || ledger.evidenceText.length > 0
    },

    hasRef(ref: string): boolean {
      return (
        ledger.chunks.some((chunk) => chunk.ref === ref) ||
        ledger.assets.some((asset) => asset.ref === ref)
      )
    },

    snapshot(): EvidenceLedgerSnapshot {
      return snapshot(ledger)
    },
  }
}

function addChunkFromResult(input: {
  readonly ledger: MutableLedger
  readonly result: RetrievalResult
  readonly ref: string
  readonly kind: EvidenceChunk["kind"]
}): void {
  addChunk({
    ledger: input.ledger,
    chunk: {
      ref: input.ref,
      kind: input.kind,
      content: input.result.content,
      contentPreview: buildContentPreview(input.result.content),
      chunkType: input.result.chunkType,
      score: input.result.score,
      chunkId: input.result.chunkId,
      sourceChunkPath: input.result.sourceChunkPath,
      filePath: input.result.filePath,
      metadata: input.result.metadata,
      source: {
        documentId: input.result.source.documentId,
        sourceFileName: input.result.source.sourceFileName,
        sectionPath: input.result.source.sectionPath,
      },
      ...(input.result.assetUrl ? { assetUrl: input.result.assetUrl } : {}),
    },
  })
}

function addChunkFromReadChunk(input: {
  readonly ledger: MutableLedger
  readonly response: KnowledgeReadResponse
  readonly chunk: KnowledgeReadChunk
  readonly ref: string
}): void {
  addChunk({
    ledger: input.ledger,
    chunk: {
      ref: input.ref,
      kind: "read_chunk",
      chunkId: input.chunk.chunkId,
      content: input.chunk.content,
      contentPreview: buildContentPreview(input.chunk.content),
      chunkType: input.chunk.chunkType,
      score: null,
      sourceChunkPath: input.chunk.sourceChunkPath,
      filePath: input.chunk.filePath,
      metadata: input.chunk.metadata,
      source: {
        documentId: input.response.document.documentId,
        sourceFileName: input.response.document.sourceFileName,
        sectionPath: input.chunk.sectionPath,
      },
      revisionKey: input.response.document.jobId,
      ...(input.chunk.assetUrl ? { assetUrl: input.chunk.assetUrl } : {}),
    },
  })
}

function addChunkFromGrepMatch(input: {
  readonly ledger: MutableLedger
  readonly response: KnowledgeGrepResponse
  readonly match: KnowledgeGrepMatch
  readonly ref: string
}): void {
  const donor = input.ledger.chunks.find(
    (chunk) =>
      chunk.chunkId === input.match.chunkId && hasPageMetadata(chunk.metadata),
  )
  const pageNums =
    input.match.pageNumbers && input.match.pageNumbers.length > 0
      ? [...input.match.pageNumbers]
      : undefined

  addChunk({
    ledger: input.ledger,
    chunk: {
      ref: input.ref,
      kind: "grep_match",
      chunkId: input.match.chunkId,
      content: input.match.snippet,
      contentPreview: buildContentPreview(input.match.snippet),
      chunkType: input.match.chunkType,
      score: null,
      sourceChunkPath: input.match.sourceChunkPath,
      filePath: input.match.filePath,
      metadata: {
        ...(donor?.metadata ?? {}),
        ...(pageNums ? { pageNums } : {}),
        position: input.match.position,
        startOffset: input.match.startOffset,
        endOffset: input.match.endOffset,
      },
      source: {
        documentId: input.response.document.documentId,
        sourceFileName: input.response.document.sourceFileName,
        sectionPath: input.match.sectionPath,
      },
      revisionKey: input.response.document.jobId,
    },
  })
}

function hasPageMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!metadata) return false
  const values = [
    metadata.pageNums,
    metadata.page_nums,
    metadata.pageNum,
    metadata.page_num,
    metadata.pageAssets,
    metadata.page_assets,
  ]
  return values.some((value) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "number") return Number.isSafeInteger(value) && value > 0
    if (typeof value === "string") return value.trim().length > 0
    return false
  })
}

function addChunk(input: {
  readonly ledger: MutableLedger
  readonly chunk: Omit<EvidenceChunk, "assetRef">
}): void {
  const asset = getEvidenceAssetCandidate(input.chunk)
  if (!asset) {
    input.ledger.chunks.push(input.chunk)
    return
  }

  const assetRef = `asset:${input.chunk.ref}`
  const chunk: EvidenceChunk = {
    ...input.chunk,
    assetRef,
  }
  input.ledger.chunks.push(chunk)
  input.ledger.assets.push({
    ref: assetRef,
    chunkRef: chunk.ref,
    type: asset.type,
    ...(asset.assetUrl ? { assetUrl: asset.assetUrl } : {}),
    ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
    ...(chunk.revisionKey ? { revisionKey: chunk.revisionKey } : {}),
    source: chunk.source,
    label: asset.label,
  })
}

function buildContentPreview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (normalized.length <= contentPreviewLimit) return normalized
  return `${normalized.slice(0, contentPreviewLimit)}...`
}

function isRenderableAsset(chunkType: string, assetUrl: string): boolean {
  const normalizedChunkType = chunkType.toLowerCase()
  return (
    normalizedChunkType === "image" ||
    normalizedChunkType === "table" ||
    isImageAssetUrl(assetUrl)
  )
}

function getEvidenceAssetCandidate(
  chunk: Omit<EvidenceChunk, "assetRef">,
): EvidenceAssetCandidate | null {
  const pageAsset = getPageCitationAssetCandidate(chunk)
  if (pageAsset) {
    return pageAsset
  }

  const assetUrl = getTrimmedString(chunk.assetUrl)
  if (!assetUrl || !isRenderableAsset(chunk.chunkType, assetUrl)) return null

  const sourcePath = getAssetSourcePath(chunk, assetUrl)
  return {
    type: getAssetType(chunk.chunkType, assetUrl),
    assetUrl,
    ...(sourcePath ? { sourcePath } : {}),
    label: formatAssetLabel(chunk, sourcePath),
  }
}

function getPageCitationAssetCandidate(
  chunk: Omit<EvidenceChunk, "assetRef">,
): EvidenceAssetCandidate | null {
  if (chunk.chunkType.toLowerCase() !== "page") return null

  const candidates = [
    ...parsePageCitationAssetCandidates(chunk.metadata?.pageAssets),
    ...parsePageCitationAssetCandidates(chunk.metadata?.page_assets),
  ].filter(isSupportedPageCitationAsset)
  if (candidates.length === 0) return null

  const pageNumbers = getPageNumbers(chunk.metadata)
  const candidate =
    pageNumbers.length > 0
      ? candidates.find((item) => pageNumbers.includes(item.pageNum)) ??
        candidates[0]
      : candidates[0]
  if (!candidate) return null

  const sourcePath = getTrimmedString(candidate.artifactRef)
  const assetUrl =
    getTrimmedString(candidate.assetUrl) ?? getTrimmedString(chunk.assetUrl)
  if (!sourcePath && !assetUrl) return null

  return {
    type: "image",
    ...(assetUrl ? { assetUrl } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    label: formatAssetLabel(chunk, sourcePath),
  }
}

function getAssetType(chunkType: string, assetUrl: string): "image" | "table" {
  return chunkType.toLowerCase() === "table" && !isImageAssetUrl(assetUrl)
    ? "table"
    : "image"
}

function isImageAssetUrl(assetUrl: string): boolean {
  const pathname = getUrlPathname(assetUrl).toLowerCase()
  return imageExtensions.some((extension) => pathname.endsWith(extension))
}

function getAssetSourcePath(
  chunk: Omit<EvidenceChunk, "assetRef">,
  assetUrl: string,
): string | null {
  const candidates = [
    chunk.filePath,
    chunk.sourceChunkPath,
    chunk.source.sectionPath,
    getUrlPathname(assetUrl),
  ]

  for (const candidate of candidates) {
    const sourcePath = getSupportedAssetPath(candidate)
    if (sourcePath) return sourcePath
  }

  return null
}

function getSupportedAssetPath(value: string | null | undefined): string | null {
  const normalizedText = normalizeSourcePathCandidate(value)
  if (!normalizedText) return null

  const match =
    /(?:^|\/)((?:images|tables|pages|page_citation_assets)\/[^?#]+)(?:[?#]|$)?/i.exec(
      normalizedText,
    )
  const matchedPath = match?.[1]
  return matchedPath ? matchedPath.trim() : null
}

function getUrlPathname(assetUrl: string): string {
  try {
    return new URL(assetUrl).pathname
  } catch {
    return assetUrl.split("?")[0] ?? assetUrl
  }
}

function parsePageCitationAssetCandidates(
  value: unknown,
): readonly PageCitationAssetCandidate[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): PageCitationAssetCandidate[] => {
    if (!isRecord(item)) return []
    const pageNum =
      getPositiveInteger(item.pageNum) ??
      getPositiveInteger(item.page_num) ??
      getPositiveInteger(item.pageNumber)
    if (!pageNum) return []
    const artifactRef =
      getTrimmedString(item.artifactRef) ??
      getTrimmedString(item.artifact_ref)
    const assetUrl =
      getTrimmedString(item.assetUrl) ?? getTrimmedString(item.asset_url)
    const contentType =
      getTrimmedString(item.contentType) ??
      getTrimmedString(item.content_type)

    return [
      {
        pageNum,
        ...(artifactRef ? { artifactRef } : {}),
        ...(assetUrl ? { assetUrl } : {}),
        ...(contentType ? { contentType } : {}),
      },
    ]
  })
}

function isSupportedPageCitationAsset(
  candidate: PageCitationAssetCandidate,
): boolean {
  const contentType = candidate.contentType?.toLowerCase()
  return (
    contentType?.startsWith("image/") === true ||
    hasImageExtension(candidate.artifactRef) ||
    hasImageExtension(candidate.assetUrl)
  )
}

function hasImageExtension(value: string | null | undefined): boolean {
  const normalized = normalizeSourcePathCandidate(value)?.toLowerCase()
  return (
    normalized !== undefined &&
    imageExtensions.some((extension) => normalized.endsWith(extension))
  )
}

function getPageNumbers(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly number[] {
  if (!metadata) return []

  const values = [
    metadata.pageNums,
    metadata.page_nums,
    metadata.pageNum,
    metadata.page_num,
  ]
  const pageNumbers = new Set<number>()

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const pageNum = getPositiveInteger(item)
        if (pageNum) pageNumbers.add(pageNum)
      }
      continue
    }

    const pageNum = getPositiveInteger(value)
    if (pageNum) pageNumbers.add(pageNum)
  }

  return [...pageNumbers].sort((left, right) => left - right)
}

function getTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getPositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null
}

function normalizeSourcePathCandidate(
  value: string | null | undefined,
): string | null {
  const trimmedValue = getTrimmedString(value)
  if (!trimmedValue) return null

  const normalized = decodeUrlText(trimmedValue)
    .replaceAll("\\", "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()

  return normalized.length > 0 ? normalized : null
}

function decodeUrlText(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function formatAssetLabel(
  chunk: EvidenceChunk,
  sourcePath?: string | null,
): string {
  const labels = [
    chunk.source.sourceFileName,
    chunk.source.sectionPath,
    sourcePath,
    chunk.chunkType,
  ]
  const uniqueLabels: string[] = []

  for (const label of labels) {
    const normalized = label?.trim()
    if (!normalized || uniqueLabels.includes(normalized)) continue
    uniqueLabels.push(normalized)
  }

  return uniqueLabels.join(" / ")
}

function snapshot(ledger: MutableLedger): EvidenceLedgerSnapshot {
  return {
    retrievalCount: ledger.retrievalCount,
    chunks: [...ledger.chunks],
    assets: [...ledger.assets],
    evidenceText: [...ledger.evidenceText],
    stopReasons: [...ledger.stopReasons],
    failureReasons: [...ledger.failureReasons],
    decisionTraces: [...ledger.decisionTraces],
  }
}

function getDecisionTrace(response: RetrievalQueryResponse): unknown | null {
  const record = response as RetrievalQueryResponse & {
    readonly decision_trace?: unknown
    readonly decisionTree?: unknown
    readonly decision_tree?: unknown
  }
  return (
    response.decisionTrace ??
    record.decision_trace ??
    record.decisionTree ??
    record.decision_tree ??
    null
  )
}
