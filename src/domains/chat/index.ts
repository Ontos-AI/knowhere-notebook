import { Effect } from "effect"
import type {
  RetrievalQueryParams,
  RetrievalQueryResponse,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import { logger } from "@/lib/logger"
import type {
  ChatArtifactView,
  ChatCitationView,
} from "@/domains/chat/types"
import type {
  DerivedTableArtifact,
  EvidenceAsset,
  EvidenceChunk,
  HarnessRunResult,
  OutputArtifact,
  OutputCitation,
} from "@/agent-harness"
import {
  toChatCitationViews,
  useNotebookSourceTitles,
} from "./citations"
import type {
  AgenticRetrievalQuery,
  AgenticRetrievalPlan,
  AgenticRetrievalTargetContent,
  AgenticRetrievalResponse,
  AnswerQuestionInput,
  AnswerQuestionResult,
} from "./contracts"
import {
  excludeDocuments,
  normalizeRetrievalQuery,
} from "./retrieval"
import {
  enrichRetrievalResultsWithAssetUrls,
  removeRetrievedMediaAssetUrls,
} from "./media-assets"

const DEFAULT_TOP_K = 8
const MAX_AGENTIC_TOP_K = 12
const MAX_CITATION_RESULTS = 20
const KNOWHERE_RESPONSE_TEXT_LOG_LIMIT = 200
const KNOWHERE_CHUNK_LOG_LIMIT = 100
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."
const HARNESS_VALIDATION_FAILURE_ANSWER =
  "I couldn't safely finish that response because the agent output did not pass Notebook's validation checks. Please try again."
const RAW_URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/g
const REDACTED_MEDIA_URL = "[media asset URL hidden]"
const RETRIEVAL_TARGET_CONTENT_DATA_TYPES: Readonly<
  Record<AgenticRetrievalTargetContent, RetrievalDataType>
> = {
  all: 1,
  text: 2,
  image: 3,
  table: 4,
  text_image: 5,
  text_table: 6,
} as const

type RetrievalDataType = NonNullable<RetrievalQueryParams["dataType"]>

type KnowhereQueryResponseLog = {
  readonly namespace: string
  readonly query: string
  readonly routerUsed: string | null | undefined
  readonly stopReason: string | null | undefined
  readonly failureReason: string | null | undefined
  readonly resultCount: number
  readonly referencedChunkCount: number
  readonly answerText: string
  readonly evidenceText: string
  readonly results: readonly KnowhereResultChunkLog[]
  readonly referencedChunks: readonly KnowhereReferencedChunkLog[]
}

type KnowhereResultChunkLog = {
  readonly chunkType: string
  readonly content: string
}

type KnowhereReferencedChunkLog = {
  readonly chunkType: string
  readonly summary: string
}

export type {
  AnswerQuestionInput,
  AnswerQuestionResult,
  ChatHistoryMessage,
  GenerateAnswer,
  RetrievalClient,
  SearchSources,
} from "./contracts"
export {
  generateAgenticOutputManifest,
  generateAgenticOutputManifestEffect,
} from "./prompt"
export {
  parseChatRequestBody,
  type ParsedChatRequest,
  type ParseChatRequestResult,
} from "./request"

export const answerQuestionWithRetrieval = (
  input: AnswerQuestionInput,
): Effect.Effect<AnswerQuestionResult, unknown> =>
  Effect.gen(function* () {
    const question = input.question.trim()
    const retrievalResponses: RetrievalQueryResponse[] = []

    logger.info("chat-agent: answer start", {
      questionLength: question.length,
      sourceCount: input.sources.length,
      excludedSourceCount: input.excludedSourceIds.length,
      messageCount: input.messages.length,
    })

    const searchSources = async (
      queryInput: AgenticRetrievalQuery,
    ): Promise<AgenticRetrievalResponse> => {
      const startedAt = Date.now()
      const retrievalPlan = toAgenticRetrievalPlan(queryInput)
      const retrievalQueryParams = buildRetrievalQueryParams({
        input: queryInput,
        fallbackQuestion: question,
        namespace: input.namespace,
        sources: input.sources,
        excludedSourceIds: input.excludedSourceIds,
      })
      logger.info("chat-agent: searchSources start", {
        query: retrievalQueryParams.query,
        topK: retrievalQueryParams.topK,
        dataType: retrievalQueryParams.dataType ?? null,
        signalPathCount: retrievalQueryParams.signalPaths?.length ?? 0,
        filterMode: retrievalQueryParams.filterMode ?? null,
        threshold: retrievalQueryParams.threshold ?? null,
        targetContent: retrievalPlan.targetContent,
        purpose: retrievalPlan.purpose,
      })

      try {
        const response = await input.retrieval.query(retrievalQueryParams)
        retrievalResponses.push(response)
        logger.info("chat-agent: searchSources ok", {
          query: response.query,
          durationMs: Date.now() - startedAt,
          resultCount: response.results.length,
          referencedChunkCount: response.referencedChunks.length,
          stopReason: response.stopReason ?? null,
          failureReason: response.failureReason ?? null,
          targetContent: retrievalPlan.targetContent,
        })
        logger.info("chat-agent: knowhere query response", {
          durationMs: Date.now() - startedAt,
          response: formatKnowhereQueryResponseForLog(response),
        })
        return { ...response, retrievalPlan }
      } catch (error) {
        logger.error("chat-agent: searchSources failed", {
          query: retrievalQueryParams.query,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          targetContent: retrievalPlan.targetContent,
        })
        throw error
      }
    }

    const generatedAnswer = yield* Effect.tryPromise(() =>
      input.generateAnswer({
        question,
        messages: input.messages,
        sources: input.sources,
        excludedSourceIds: input.excludedSourceIds,
        searchSources,
      }),
    )

    logger.info("chat-agent: answer generated", {
      answerLength: generatedAnswer.manifest.text.length,
      retrievalCallCount: retrievalResponses.length,
      citationCount: generatedAnswer.manifest.citations.length,
      harnessValidationErrorCount: generatedAnswer.trace.validationErrors.length,
      revisionsUsed: generatedAnswer.trace.revisionsUsed,
    })
    if (generatedAnswer.trace.validationErrors.length > 0) {
      logger.warn("chat-agent: validation failed; returning safe fallback", {
        validationErrors: generatedAnswer.trace.validationErrors,
        revisionsUsed: generatedAnswer.trace.revisionsUsed,
        finalized: generatedAnswer.trace.finalized,
        intentTask: generatedAnswer.trace.intent?.task ?? null,
        retrievalCallCount: retrievalResponses.length,
      })
      return {
        answer: HARNESS_VALIDATION_FAILURE_ANSWER,
        citations: [] as ChatCitationView[],
        artifacts: [] as ChatArtifactView[],
      }
    }

    const rawResults = selectCitationRawResults({
      generatedAnswer,
      retrievalResponses,
      sources: input.sources,
    })
    if (
      rawResults.length === 0 &&
      generatedAnswer.manifest.text.trim().length === 0 &&
      !hasDisplayedManifestArtifacts(generatedAnswer)
    ) {
      return {
        answer: NO_RESULTS_ANSWER,
        citations: [] as ChatCitationView[],
        artifacts: [] as ChatArtifactView[],
      }
    }

    const enrichedResults = yield* Effect.tryPromise(() =>
      enrichRetrievalResultsWithAssetUrls({
        results: useNotebookSourceTitles(rawResults, input.sources),
        sources: input.sources,
        loadSourceAssetUrls: input.loadSourceAssetUrls,
        evidenceText: formatRetrievalEvidenceText(retrievalResponses),
      }),
    )
    const artifacts = toChatArtifactViewsFromHarness(generatedAnswer, input.sources)
    const hardenedMedia = yield* Effect.tryPromise(() =>
      hardenAnswerMediaAssetUrls({
        input,
        results: enrichedResults,
        artifacts,
      }),
    )
    const answer = sanitizeGeneratedAnswer({
      answer: generatedAnswer.manifest.text,
      results: getGeneratedAnswerSanitizerResults({
        rawResults,
        enrichedResults,
        hardenedResults: hardenedMedia.results,
        artifacts,
        hardenedArtifacts: hardenedMedia.artifacts,
      }),
    })
    const citationResults = hardenedMedia.results
    const displayArtifacts = hardenedMedia.artifacts ?? []
    logger.info("chat-agent: answer complete", {
      answerLength: answer.length,
      citationCount: citationResults.length,
      artifactCount: displayArtifacts.length,
    })
    return {
      answer,
      citations: toChatCitationViews(citationResults, answer),
      artifacts: displayArtifacts,
    }
  })

function toChatArtifactViewsFromHarness(
  result: HarnessRunResult,
  sources: readonly AnswerQuestionInput["sources"][number][],
): ChatArtifactView[] | undefined {
  const assetsByRef = new Map(
    result.trace.ledger.assets.map((asset): readonly [string, EvidenceAsset] => [
      asset.ref,
      asset,
    ]),
  )
  const chunksByRef = new Map(
    result.trace.ledger.chunks.map((chunk): readonly [string, EvidenceChunk] => [
      chunk.ref,
      chunk,
    ]),
  )

  const displayLimit = getHarnessArtifactDisplayLimit(result)
  const artifacts: ChatArtifactView[] = []
  let displayedArtifactCount = 0

  for (const artifact of result.manifest.artifacts) {
    const artifactView =
      artifact.type === "derived_table"
        ? toDerivedTableArtifactView(artifact)
        : resolveHarnessArtifactView({
            artifact,
            assetsByRef,
            chunksByRef,
            sources,
          })
    if (!artifactView) continue

    const isDisplayed = artifactView.display !== false
    if (
      isDisplayed &&
      typeof displayLimit === "number" &&
      displayedArtifactCount >= displayLimit
    ) {
      continue
    }

    artifacts.push(artifactView)
    if (isDisplayed) displayedArtifactCount += 1
  }

  return artifacts.length > 0 ? artifacts : undefined
}

function toDerivedTableArtifactView(
  artifact: DerivedTableArtifact,
): ChatArtifactView {
  return {
    type: "derived_table",
    ref: artifact.ref,
    title: artifact.title,
    columns: artifact.columns,
    rows: artifact.rows,
    sourceRefs: artifact.sourceRefs,
    display: artifact.display,
    reason: artifact.reason,
  }
}

function getHarnessArtifactDisplayLimit(result: HarnessRunResult): number | null {
  const constraints = result.trace.intent?.constraints
  const limits = [constraints?.desiredCount, constraints?.maxCount].filter(
    (value): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0,
  )
  return limits.length > 0 ? Math.min(...limits) : null
}

function resolveHarnessArtifactView(input: {
  readonly artifact: OutputArtifact
  readonly assetsByRef: ReadonlyMap<string, EvidenceAsset>
  readonly chunksByRef: ReadonlyMap<string, EvidenceChunk>
  readonly sources: readonly AnswerQuestionInput["sources"][number][]
}): ChatArtifactView | null {
  const asset = input.assetsByRef.get(input.artifact.ref)
  if (asset) {
    return toChatArtifactView({
      artifact: input.artifact,
      asset,
      sources: input.sources,
    })
  }

  const chunk = input.chunksByRef.get(input.artifact.ref)
  const chunkAssetRef = chunk?.assetRef
  const chunkAsset = chunkAssetRef ? input.assetsByRef.get(chunkAssetRef) : null
  return chunkAsset
    ? toChatArtifactView({
        artifact: input.artifact,
        asset: chunkAsset,
        sources: input.sources,
      })
    : null
}

function toChatArtifactView(input: {
  readonly artifact: OutputArtifact
  readonly asset: EvidenceAsset
  readonly sources: readonly AnswerQuestionInput["sources"][number][]
}): ChatArtifactView {
  const source = normalizeHarnessSource(input.asset.source, input.sources)
  return {
    type: input.artifact.type,
    ref: input.artifact.ref,
    display: input.artifact.display,
    reason: input.artifact.reason,
    assetUrl: input.asset.assetUrl,
    label: input.asset.label,
    citation: {
      chunkType: input.asset.type,
      score: null,
      assetUrl: input.asset.assetUrl,
      source,
    },
  }
}

function normalizeHarnessSource(
  source: OutputCitation["source"],
  sources: readonly AnswerQuestionInput["sources"][number][],
): ChatCitationView["source"] {
  const sourceTitle = source.documentId
    ? sources.find((candidate) => candidate.knowhereDocumentId === source.documentId)
        ?.title
    : undefined

  return {
    documentId: source.documentId,
    sourceFileName: sourceTitle ?? source.sourceFileName,
    sectionPath: source.sectionPath,
  }
}

type AnswerMediaAssetHardeningInput = {
  readonly input: AnswerQuestionInput
  readonly results: readonly RetrievalResult[]
  readonly artifacts?: readonly ChatArtifactView[]
}

async function hardenAnswerMediaAssetUrls({
  input,
  results,
  artifacts,
}: AnswerMediaAssetHardeningInput): Promise<{
  readonly results: RetrievalResult[]
  readonly artifacts?: ChatArtifactView[]
}> {
  if (!input.hardenMediaAssetUrls) {
    return {
      results: [...results],
      ...(artifacts ? { artifacts: [...artifacts] } : {}),
    }
  }

  try {
    const hardened = await input.hardenMediaAssetUrls({ results, artifacts })
    const hardenedArtifacts = hardened.artifacts ?? artifacts
    return {
      results: hardened.results,
      ...(hardenedArtifacts ? { artifacts: [...hardenedArtifacts] } : {}),
    }
  } catch (error) {
    logger.warn("chat-agent: media asset hardening failed; using raw URLs", {
      error: formatUnknownError(error),
    })
    return {
      results: [...results],
      ...(artifacts ? { artifacts: [...artifacts] } : {}),
    }
  }
}

type GeneratedAnswerSanitizerResultsInput = {
  readonly rawResults: readonly RetrievalResult[]
  readonly enrichedResults: readonly RetrievalResult[]
  readonly hardenedResults: readonly RetrievalResult[]
  readonly artifacts?: readonly ChatArtifactView[]
  readonly hardenedArtifacts?: readonly ChatArtifactView[]
}

function getGeneratedAnswerSanitizerResults({
  rawResults,
  enrichedResults,
  hardenedResults,
  artifacts,
  hardenedArtifacts,
}: GeneratedAnswerSanitizerResultsInput): RetrievalResult[] {
  return [
    ...rawResults,
    ...enrichedResults,
    ...hardenedResults,
    ...toArtifactSanitizerResults(artifacts),
    ...toArtifactSanitizerResults(hardenedArtifacts),
  ]
}

function toArtifactSanitizerResults(
  artifacts: readonly ChatArtifactView[] | undefined,
): RetrievalResult[] {
  return (artifacts ?? []).flatMap((artifact): RetrievalResult[] => {
    const results: RetrievalResult[] = []
    if (artifact.assetUrl) {
      results.push(
        toArtifactSanitizerResult({
          assetUrl: artifact.assetUrl,
          artifact,
          citation: artifact.citation,
        }),
      )
    }
    if (artifact.citation?.assetUrl) {
      results.push(
        toArtifactSanitizerResult({
          assetUrl: artifact.citation.assetUrl,
          artifact,
          citation: artifact.citation,
        }),
      )
    }
    return results
  })
}

function toArtifactSanitizerResult(input: {
  readonly assetUrl: string
  readonly artifact: ChatArtifactView
  readonly citation?: ChatCitationView
}): RetrievalResult {
  return {
    content: input.citation?.content ?? "",
    chunkType: input.citation?.chunkType ?? input.artifact.type,
    score: input.citation?.score ?? null,
    assetUrl: input.assetUrl,
    source: {
      documentId: input.citation?.source.documentId ?? undefined,
      sourceFileName: input.citation?.source.sourceFileName ?? undefined,
      sectionPath: input.citation?.source.sectionPath ?? undefined,
    },
  }
}

type GeneratedAnswerSanitizerInput = {
  readonly answer: string
  readonly results: readonly RetrievalResult[]
}

function sanitizeGeneratedAnswer({
  answer,
  results,
}: GeneratedAnswerSanitizerInput): string {
  return removeRetrievedMediaAssetUrls(answer, results)
}

function formatKnowhereQueryResponseForLog(
  response: RetrievalQueryResponse,
): KnowhereQueryResponseLog {
  return {
    namespace: response.namespace,
    query: response.query,
    routerUsed: response.routerUsed,
    stopReason: response.stopReason,
    failureReason: response.failureReason,
    resultCount: response.results.length,
    referencedChunkCount: response.referencedChunks.length,
    answerText: truncateLogText(
      response.answerText ?? "",
      KNOWHERE_RESPONSE_TEXT_LOG_LIMIT,
    ),
    evidenceText: truncateLogText(
      response.evidenceText ?? "",
      KNOWHERE_RESPONSE_TEXT_LOG_LIMIT,
    ),
    results: response.results.map(formatKnowhereResultChunkForLog),
    referencedChunks: response.referencedChunks.map(
      formatKnowhereReferencedChunkForLog,
    ),
  }
}

function formatKnowhereResultChunkForLog(
  result: RetrievalResult,
): KnowhereResultChunkLog {
  return {
    chunkType: result.chunkType,
    content: truncateLogText(result.content, KNOWHERE_CHUNK_LOG_LIMIT),
  }
}

function formatKnowhereReferencedChunkForLog(
  chunk: RetrievalQueryResponse["referencedChunks"][number],
): KnowhereReferencedChunkLog {
  return {
    chunkType: chunk.chunkType,
    summary: truncateLogText(
      chunk.sectionPath || chunk.filePath || chunk.chunkId,
      KNOWHERE_CHUNK_LOG_LIMIT,
    ),
  }
}

function truncateLogText(value: string, limit: number): string {
  const normalized = redactRawUrls(value).replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

function redactRawUrls(value: string): string {
  return value.replace(RAW_URL_PATTERN, REDACTED_MEDIA_URL)
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function buildRetrievalQueryParams(input: {
  readonly input: AgenticRetrievalQuery
  readonly fallbackQuestion: string
  readonly namespace: string
  readonly sources: AnswerQuestionInput["sources"]
  readonly excludedSourceIds: readonly string[]
}): RetrievalQueryParams {
  const query = normalizeRetrievalQuery(
    input.input.query,
    input.fallbackQuestion,
  )
  const dataType = normalizeRetrievalDataType(input.input.targetContent)
  return {
    namespace: input.namespace,
    query,
    topK: normalizeTopK(input.input.topK),
    useAgentic: true,
    dataType,
    ...(input.input.signalPaths && input.input.signalPaths.length > 0
      ? { signalPaths: input.input.signalPaths }
      : {}),
    ...(input.input.filterMode ? { filterMode: input.input.filterMode } : {}),
    ...(typeof input.input.threshold === "number"
      ? { threshold: input.input.threshold }
      : {}),
    ...excludeDocuments(input.sources, input.excludedSourceIds),
  }
}

function toAgenticRetrievalPlan(
  input: AgenticRetrievalQuery,
): AgenticRetrievalPlan {
  return {
    targetContent: normalizeRetrievalTargetContent(input.targetContent),
    purpose: normalizeRetrievalPurpose(input.purpose),
  }
}

function normalizeRetrievalPurpose(value: string | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim()
  if (!normalized) return null
  return normalized.slice(0, 240)
}

function normalizeRetrievalDataType(
  targetContent: AgenticRetrievalTargetContent | undefined,
): RetrievalDataType {
  return RETRIEVAL_TARGET_CONTENT_DATA_TYPES[
    normalizeRetrievalTargetContent(targetContent)
  ]
}

function normalizeRetrievalTargetContent(
  value: AgenticRetrievalTargetContent | undefined,
): AgenticRetrievalTargetContent {
  return value ?? "all"
}

function normalizeTopK(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_TOP_K
  }
  return Math.min(Math.max(value, 1), MAX_AGENTIC_TOP_K)
}

/**
 * Display citations come from the agent-curated manifest (the refs it chose to
 * cite), resolved against the evidence ledger. Only when the agent cited
 * nothing do we fall back to the full set of retrieved results, so a grounded
 * answer still shows its sources instead of appearing unsupported.
 */
function selectCitationRawResults(input: {
  readonly generatedAnswer: HarnessRunResult
  readonly retrievalResponses: readonly RetrievalQueryResponse[]
  readonly sources: readonly AnswerQuestionInput["sources"][number][]
}): RetrievalResult[] {
  const curated = mapManifestCitationsToResults(input.generatedAnswer)
  if (curated.length > 0) return curated
  const displayedArtifacts = mapDisplayedManifestArtifactsToResults(
    input.generatedAnswer,
  )
  if (displayedArtifacts.length > 0) return displayedArtifacts
  return collectRetrievalResults(input.retrievalResponses, input.sources)
}

function mapManifestCitationsToResults(
  result: HarnessRunResult,
): RetrievalResult[] {
  const chunksByRef = new Map(
    result.trace.ledger.chunks.map((chunk): readonly [string, EvidenceChunk] => [
      chunk.ref,
      chunk,
    ]),
  )
  const assetsByRef = new Map(
    result.trace.ledger.assets.map((asset): readonly [string, EvidenceAsset] => [
      asset.ref,
      asset,
    ]),
  )

  const results: RetrievalResult[] = []
  const seenKeys = new Set<string>()

  for (const citation of result.manifest.citations) {
    const chunk =
      chunksByRef.get(citation.ref) ??
      resolveChunkForAssetRef(citation.ref, assetsByRef, chunksByRef)
    if (!chunk) continue

    const retrievalResult: RetrievalResult = {
      content: chunk.content,
      chunkType: chunk.chunkType,
      score: chunk.score,
      ...(chunk.assetUrl ? { assetUrl: chunk.assetUrl } : {}),
      source: {
        documentId: chunk.source.documentId ?? undefined,
        sourceFileName: chunk.source.sourceFileName ?? undefined,
        sectionPath: chunk.source.sectionPath ?? undefined,
      },
    }
    const key = getRetrievalResultKey(retrievalResult)
    if (seenKeys.has(key)) continue

    seenKeys.add(key)
    results.push(retrievalResult)
    if (results.length >= MAX_CITATION_RESULTS) break
  }

  return results
}

function resolveChunkForAssetRef(
  ref: string,
  assetsByRef: ReadonlyMap<string, EvidenceAsset>,
  chunksByRef: ReadonlyMap<string, EvidenceChunk>,
): EvidenceChunk | undefined {
  const asset = assetsByRef.get(ref)
  if (!asset) return undefined
  return chunksByRef.get(asset.chunkRef)
}

function mapDisplayedManifestArtifactsToResults(
  result: HarnessRunResult,
): RetrievalResult[] {
  const chunksByRef = new Map(
    result.trace.ledger.chunks.map((chunk): readonly [string, EvidenceChunk] => [
      chunk.ref,
      chunk,
    ]),
  )
  const assetsByRef = new Map(
    result.trace.ledger.assets.map((asset): readonly [string, EvidenceAsset] => [
      asset.ref,
      asset,
    ]),
  )

  const results: RetrievalResult[] = []
  const seenKeys = new Set<string>()
  const displayLimit = getHarnessArtifactDisplayLimit(result)

  for (const artifact of result.manifest.artifacts) {
    if (!artifact.display) continue
    if (typeof displayLimit === "number" && results.length >= displayLimit) {
      break
    }

    if (artifact.type === "derived_table") {
      for (const sourceRef of artifact.sourceRefs) {
        const chunk =
          chunksByRef.get(sourceRef) ??
          resolveChunkForAssetRef(sourceRef, assetsByRef, chunksByRef)
        if (!chunk) continue

        const retrievalResult = toRetrievalResultFromEvidenceChunk(chunk)
        const key = getRetrievalResultKey(retrievalResult)
        if (seenKeys.has(key)) continue

        seenKeys.add(key)
        results.push(retrievalResult)
        if (results.length >= MAX_CITATION_RESULTS) return results
      }
      continue
    }

    const chunk =
      chunksByRef.get(artifact.ref) ??
      resolveChunkForAssetRef(artifact.ref, assetsByRef, chunksByRef)
    if (!chunk) continue

    const retrievalResult = toRetrievalResultFromEvidenceChunk(chunk)
    const key = getRetrievalResultKey(retrievalResult)
    if (seenKeys.has(key)) continue

    seenKeys.add(key)
    results.push(retrievalResult)
    if (results.length >= MAX_CITATION_RESULTS) break
  }

  return results
}

function toRetrievalResultFromEvidenceChunk(
  chunk: EvidenceChunk,
): RetrievalResult {
  return {
    content: chunk.content,
    chunkType: chunk.chunkType,
    score: chunk.score,
    ...(chunk.assetUrl ? { assetUrl: chunk.assetUrl } : {}),
    source: {
      documentId: chunk.source.documentId ?? undefined,
      sourceFileName: chunk.source.sourceFileName ?? undefined,
      sectionPath: chunk.source.sectionPath ?? undefined,
    },
  }
}

function hasDisplayedManifestArtifacts(result: HarnessRunResult): boolean {
  return result.manifest.artifacts.some((artifact) => artifact.display)
}

function collectRetrievalResults(
  responses: readonly RetrievalQueryResponse[],
  sources: readonly AnswerQuestionInput["sources"][number][],
): RetrievalResult[] {
  const results: RetrievalResult[] = []
  const seenKeys = new Set<string>()
  const sourceTitlesByDocumentId = new Map(
    sources.flatMap((source): readonly [string, string][] =>
      source.knowhereDocumentId ? [[source.knowhereDocumentId, source.title]] : [],
    ),
  )

  for (const response of responses) {
    for (const result of [
      ...response.results,
      ...response.referencedChunks.map((chunk): RetrievalResult => ({
        content: "",
        chunkType: chunk.chunkType,
        score: null,
        ...(chunk.assetUrl ? { assetUrl: chunk.assetUrl } : {}),
        source: {
          documentId: chunk.documentId,
          sourceFileName: sourceTitlesByDocumentId.get(chunk.documentId),
          sectionPath: chunk.sectionPath,
        },
      })),
    ]) {
      const key = getRetrievalResultKey(result)
      if (seenKeys.has(key)) continue

      seenKeys.add(key)
      results.push(result)
      if (results.length >= MAX_CITATION_RESULTS) return results
    }
  }

  return results
}

function formatRetrievalEvidenceText(
  responses: readonly RetrievalQueryResponse[],
): string | undefined {
  const evidenceText = responses
    .map((response): string => response.evidenceText?.trim() ?? "")
    .filter((value): boolean => value.length > 0)
    .join("\n")

  return evidenceText || undefined
}

function getRetrievalResultKey(result: RetrievalResult): string {
  const source = result.source
  return [
    source.documentId ?? "",
    source.sourceFileName ?? "",
    source.sectionPath ?? "",
    result.chunkType,
    result.assetUrl ?? "",
    result.content.slice(0, 500),
  ]
    .map((part) => `${part.length}:${part}`)
    .join("|")
}
