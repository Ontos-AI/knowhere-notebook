import type {
  RetrievalQueryResponse,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import type {
  EvidenceAsset,
  EvidenceChunk,
  EvidenceLedgerSnapshot,
  PendingRetentionRange,
  ResolveConnectedAssets,
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
  retainedPicks: Set<number>
  pendingRetention: PendingRetentionRange | null
}

type EvidenceAssetCandidate = {
  readonly type: EvidenceAsset["type"]
  readonly assetUrl?: string
  readonly sourcePath?: string
  readonly label: string
}

type ConnectedAssetCandidate = {
  readonly chunkRef: string
  readonly targetChunkId: string
  readonly documentId: string
  readonly type: EvidenceAsset["type"]
  readonly sourcePath: string
  readonly source: EvidenceChunk["source"]
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
    chunks: [],
    assets: [],
    evidenceText: [],
    stopReasons: [],
    failureReasons: [],
    decisionTraces: [],
    retainedPicks: new Set<number>(),
    pendingRetention: null,
  }

  return {
    addRetrievalResponse(response: RetrievalQueryResponse): EvidenceLedgerSnapshot {
      const chunkCountBefore = ledger.chunks.length
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
        // Knowhere's agent_explore router returns referencedChunks entries
        // that may carry only a summary id with no chunkType/content
        // (despite the SDK type declaring chunkType as required). Skip
        // entries missing a usable chunkType: they have no real content
        // (content is always "" here) and chunkType is required downstream
        // (asset-type detection calls chunkType.toLowerCase()).
        if (typeof chunk.chunkType !== "string" || chunk.chunkType.trim().length === 0) {
          return
        }
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

      const chunkCountAfter = ledger.chunks.length
      if (chunkCountAfter > chunkCountBefore) {
        ledger.pendingRetention = {
          startPick: chunkCountBefore + 1,
          endPick: chunkCountAfter,
        }
      }

      return snapshot(ledger)
    },

    retainPicks(picks: readonly number[]):
      | { readonly ok: true; readonly retainedPicks: readonly number[] }
      | {
          readonly ok: false
          readonly message: string
          readonly invalidPicks: readonly number[]
        } {
      const pending = ledger.pendingRetention
      if (!pending) {
        return {
          ok: false,
          message:
            "retainEvidence can only be called after a search that returned new evidence.",
          invalidPicks: [],
        }
      }

      const kept: number[] = []
      const invalidPicks: number[] = []
      for (const pick of picks) {
        if (
          !Number.isInteger(pick) ||
          pick < pending.startPick ||
          pick > pending.endPick
        ) {
          if (!invalidPicks.includes(pick)) invalidPicks.push(pick)
          continue
        }
        if (!kept.includes(pick)) kept.push(pick)
      }
      if (invalidPicks.length > 0) {
        return {
          ok: false,
          message: [
            "retainEvidence picks must come from the latest search.",
            `Invalid picks: ${invalidPicks.join(" ")}.`,
            `Latest search picks: ${pending.startPick}-${pending.endPick}.`,
          ].join(" "),
          invalidPicks,
        }
      }

      for (const pick of kept) {
        ledger.retainedPicks.add(pick)
      }
      ledger.pendingRetention = null
      return {
        ok: true,
        retainedPicks: [...ledger.retainedPicks].sort((left, right) => left - right),
      }
    },

    isRetained(pick: number): boolean {
      return ledger.retainedPicks.has(pick)
    },

    hasPendingRetention(): boolean {
      return ledger.pendingRetention !== null
    },

    pendingRetentionRange(): PendingRetentionRange | null {
      return ledger.pendingRetention
    },

    async resolveRetainedConnectedAssets(
      resolveConnectedAssets?: ResolveConnectedAssets,
    ): Promise<EvidenceLedgerSnapshot> {
      const candidates = getRetainedConnectedAssetCandidates(ledger)
      if (candidates.length === 0) return snapshot(ledger)
      if (!resolveConnectedAssets) {
        throw new Error(
          "No connected asset resolver was provided for retained evidence.",
        )
      }

      const lookups = uniqueConnectedAssetLookups(candidates)
      const resolved = await resolveConnectedAssets(lookups)
      const assetUrlByLookup = new Map(
        resolved.map((asset) => [connectedAssetLookupKey(asset), asset.assetUrl]),
      )

      for (const candidate of candidates) {
        const lookupKey = connectedAssetLookupKey({
          documentId: candidate.documentId,
          chunkId: candidate.targetChunkId,
          type: candidate.type,
        })
        const assetUrl = assetUrlByLookup.get(lookupKey)
        if (!assetUrl) {
          throw new Error(
            `Connected ${candidate.type} chunk ${candidate.targetChunkId} was not resolved.`,
          )
        }
        ledger.assets.push({
          ref: `asset:${candidate.chunkRef}:${candidate.targetChunkId}`,
          chunkRef: candidate.chunkRef,
          type: candidate.type,
          assetUrl,
          sourcePath: candidate.sourcePath,
          source: candidate.source,
          label: formatConnectedAssetLabel(candidate),
        })
      }

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

function addChunk(input: {
  readonly ledger: MutableLedger
  readonly chunk: EvidenceChunk
}): void {
  const asset = getEvidenceAssetCandidate(input.chunk)
  if (!asset) {
    input.ledger.chunks.push(input.chunk)
    return
  }

  const assetRef = `asset:${input.chunk.ref}`
  input.ledger.chunks.push(input.chunk)
  input.ledger.assets.push({
    ref: assetRef,
    chunkRef: input.chunk.ref,
    type: asset.type,
    ...(asset.assetUrl ? { assetUrl: asset.assetUrl } : {}),
    ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
    ...(input.chunk.revisionKey ? { revisionKey: input.chunk.revisionKey } : {}),
    source: input.chunk.source,
    label: asset.label,
  })
}

function getRetainedConnectedAssetCandidates(
  ledger: MutableLedger,
): ConnectedAssetCandidate[] {
  return ledger.chunks.flatMap((chunk, index) => {
    if (!ledger.retainedPicks.has(index + 1)) return []

    const documentId = getTrimmedString(chunk.source.documentId)
    const connections = chunk.metadata?.connectTo ?? chunk.metadata?.connect_to
    if (!Array.isArray(connections)) return []

    return connections.flatMap((connection): ConnectedAssetCandidate[] => {
      if (!isRecord(connection) || connection.relation !== "embeds") return []
      const targetChunkId = getTrimmedString(connection.target)
      const sourcePath = getConnectedAssetPath(connection.ref)
      if (!targetChunkId || !sourcePath) return []
      if (!documentId) {
        throw new Error(
          `Retained evidence ${chunk.ref} has connected assets but no document ID.`,
        )
      }

      return [{
        chunkRef: chunk.ref,
        targetChunkId,
        documentId,
        type: sourcePath.startsWith("images/") ? "image" : "table",
        sourcePath,
        source: chunk.source,
      }]
    })
  })
}

function getConnectedAssetPath(value: unknown): string | null {
  const ref = getTrimmedString(value)
  if (!ref || !ref.startsWith("[") || !ref.endsWith("]")) return null
  const path = ref.slice(1, -1).trim()
  return path.startsWith("images/") || path.startsWith("tables/") ? path : null
}

function uniqueConnectedAssetLookups(
  candidates: readonly ConnectedAssetCandidate[],
) {
  const lookups = new Map<
    string,
    { documentId: string; chunkId: string; type: EvidenceAsset["type"] }
  >()
  for (const candidate of candidates) {
    const lookup = {
      documentId: candidate.documentId,
      chunkId: candidate.targetChunkId,
      type: candidate.type,
    }
    lookups.set(connectedAssetLookupKey(lookup), lookup)
  }
  return [...lookups.values()]
}

function connectedAssetLookupKey(input: {
  readonly documentId: string
  readonly chunkId: string
  readonly type: EvidenceAsset["type"]
}): string {
  return `${input.documentId}\u0000${input.type}\u0000${input.chunkId}`
}

function formatConnectedAssetLabel(candidate: ConnectedAssetCandidate): string {
  return [
    candidate.source.sourceFileName,
    candidate.source.sectionPath,
    candidate.sourcePath,
    candidate.type,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ")
}

function buildContentPreview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (normalized.length <= contentPreviewLimit) return normalized
  return `${normalized.slice(0, contentPreviewLimit)}...`
}

// Knowhere's chunkType is declared as a required string in the SDK type,
// but real API responses (seen on referencedChunks; results are the same
// contract) can omit it. Normalize defensively instead of calling
// .toLowerCase() on a value that may be undefined at runtime.
function normalizeChunkType(chunkType: string): string {
  return typeof chunkType === "string" ? chunkType.toLowerCase() : ""
}

function isRenderableAsset(chunkType: string, assetUrl: string): boolean {
  const normalizedChunkType = normalizeChunkType(chunkType)
  return (
    normalizedChunkType === "image" ||
    normalizedChunkType === "table" ||
    isImageAssetUrl(assetUrl)
  )
}

function getEvidenceAssetCandidate(
  chunk: EvidenceChunk,
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
  chunk: EvidenceChunk,
): EvidenceAssetCandidate | null {
  if (normalizeChunkType(chunk.chunkType) !== "page") return null

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
  return normalizeChunkType(chunkType) === "table" && !isImageAssetUrl(assetUrl)
    ? "table"
    : "image"
}

function isImageAssetUrl(assetUrl: string): boolean {
  const pathname = getUrlPathname(assetUrl).toLowerCase()
  return imageExtensions.some((extension) => pathname.endsWith(extension))
}

function getAssetSourcePath(
  chunk: EvidenceChunk,
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
    retainedPicks: [...ledger.retainedPicks].sort((left, right) => left - right),
    pendingRetention: ledger.pendingRetention,
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
