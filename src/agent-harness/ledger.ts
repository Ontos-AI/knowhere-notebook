import type {
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
  chunks: EvidenceChunk[]
  assets: EvidenceAsset[]
  evidenceText: string[]
  stopReasons: string[]
  failureReasons: string[]
  decisionTraces: unknown[]
}

export type EvidenceLedger = ReturnType<typeof createEvidenceLedger>

export function createEvidenceLedger() {
  const ledger: MutableLedger = {
    retrievalCount: 0,
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
            content,
            contentPreview: content,
            chunkType: chunk.chunkType,
            score: null,
            chunkId: chunk.chunkId,
            source: {
              documentId: chunk.documentId,
              sourceFileName: null,
              sectionPath: chunk.sectionPath,
            },
            ...(chunk.assetUrl ? { assetUrl: chunk.assetUrl } : {}),
          },
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
      source: {
        documentId: input.result.source.documentId,
        sourceFileName: input.result.source.sourceFileName,
        sectionPath: input.result.source.sectionPath,
      },
      ...(input.result.assetUrl ? { assetUrl: input.result.assetUrl } : {}),
    },
  })
}

function addChunk(input: {
  readonly ledger: MutableLedger
  readonly chunk: Omit<EvidenceChunk, "assetRef">
}): void {
  const assetUrl = input.chunk.assetUrl?.trim()
  if (!assetUrl || !isRenderableAsset(input.chunk.chunkType, assetUrl)) {
    input.ledger.chunks.push(input.chunk)
    return
  }

  const type = getAssetType(input.chunk.chunkType, assetUrl)
  const assetRef = `asset:${input.chunk.ref}`
  const chunk: EvidenceChunk = {
    ...input.chunk,
    assetRef,
  }
  input.ledger.chunks.push(chunk)
  input.ledger.assets.push({
    ref: assetRef,
    chunkRef: chunk.ref,
    type,
    assetUrl,
    source: chunk.source,
    label: formatAssetLabel(chunk),
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

function getAssetType(chunkType: string, assetUrl: string): "image" | "table" {
  return chunkType.toLowerCase() === "table" && !isImageAssetUrl(assetUrl)
    ? "table"
    : "image"
}

function isImageAssetUrl(assetUrl: string): boolean {
  const pathname = getUrlPathname(assetUrl).toLowerCase()
  return imageExtensions.some((extension) => pathname.endsWith(extension))
}

function getUrlPathname(assetUrl: string): string {
  try {
    return new URL(assetUrl).pathname
  } catch {
    return assetUrl.split("?")[0] ?? assetUrl
  }
}

function formatAssetLabel(chunk: EvidenceChunk): string {
  return [
    chunk.source.sourceFileName,
    chunk.source.sectionPath,
    chunk.chunkType,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" / ")
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
