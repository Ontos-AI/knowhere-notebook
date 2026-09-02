import { Effect } from "effect"
import type {
  RetrievalQueryParams,
  RetrievalQueryResponse,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import { logger } from "@/lib/logger"
import { getCanonicalImageAssetKey } from "@/agent-harness/image-asset-identity"
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatImageHighlightBox,
} from "@/domains/chat/types"
import type {
  DerivedTableArtifact,
  EvidenceAsset,
  EvidenceChunk,
  HarnessRunResult,
  OutputArtifact,
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
import {
  enrichRetrievalResultsWithPageCitationAssetUrls,
  resolvePageCitationPageNumber,
} from "./page-citation-assets"
import type { HardenableRetrievalResult } from "./media-asset-hardening"
import { notebookKnowhereTools } from "./knowhere-tools"

const DEFAULT_TOP_K = 8
const MAX_AGENTIC_TOP_K = 12
const MAX_CONCURRENT_RETRIEVAL_NAMESPACES = 4
const MAX_AGENTIC_MERGED_RESULT_COUNT = 24
const MAX_AGENTIC_MERGED_REFERENCED_CHUNK_COUNT = 24
const MAX_AGENTIC_MERGED_TEXT_CHARS = 12_000
const MAX_CITATION_RESULTS = 20
const KNOWHERE_RESPONSE_TEXT_LOG_LIMIT = 200
const KNOWHERE_CHUNK_LOG_LIMIT = 100
const KNOWHERE_RESPONSE_LOG_ITEM_LIMIT = 20
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."
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

type AgenticMergedEvidenceLimits = {
  readonly resultCountPerResponse: number
  readonly referencedChunkCountPerResponse: number
  readonly resultCount: number
  readonly referencedChunkCount: number
}

type RetrievalNamespaceQueryMode = "concurrent" | "rate_limit_fallback"

type RetrievalNamespaceQueryOutcome =
  | {
      readonly status: "success"
      readonly namespace: string
      readonly response: RetrievalQueryResponse
    }
  | {
      readonly status: "failure"
      readonly namespace: string
      readonly error: unknown
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
      const namespaces = getRetrievalNamespaces(input)
      const queryResponses: RetrievalQueryResponse[] = []
      const queryFailures: unknown[] = []

      const concurrentOutcomes = await queryRetrievalNamespaces({
        namespaces,
        queryInput,
        answerInput: input,
        fallbackQuestion: question,
        retrievalPlan,
        concurrency: MAX_CONCURRENT_RETRIEVAL_NAMESPACES,
        mode: "concurrent",
      })
      const rateLimitedOutcomes = concurrentOutcomes.filter(
        (outcome) =>
          outcome.status === "failure" && isRateLimitError(outcome.error),
      )
      let finalOutcomes = concurrentOutcomes

      if (rateLimitedOutcomes.length > 0) {
        logger.warn(
          "chat-agent: searchSources rate limited; retrying failed namespaces sequentially",
          {
            namespaceCount: rateLimitedOutcomes.length,
            namespaces: rateLimitedOutcomes.map((outcome) => outcome.namespace),
          },
        )
        const fallbackOutcomes = await queryRetrievalNamespaces({
          namespaces: rateLimitedOutcomes.map((outcome) => outcome.namespace),
          queryInput,
          answerInput: input,
          fallbackQuestion: question,
          retrievalPlan,
          concurrency: 1,
          mode: "rate_limit_fallback",
        })
        const fallbackByNamespace = new Map(
          fallbackOutcomes.map(
            (outcome): readonly [string, RetrievalNamespaceQueryOutcome] => [
              outcome.namespace,
              outcome,
            ],
          ),
        )
        finalOutcomes = concurrentOutcomes.map((outcome) =>
          outcome.status === "failure" && isRateLimitError(outcome.error)
            ? (fallbackByNamespace.get(outcome.namespace) ?? outcome)
            : outcome,
        )
      }

      for (const outcome of finalOutcomes) {
        if (outcome.status === "success") {
          retrievalResponses.push(outcome.response)
          queryResponses.push(outcome.response)
        } else {
          queryFailures.push(outcome.error)
        }
      }

      logger.info("chat-agent: searchSources batch complete", {
        durationMs: Date.now() - startedAt,
        namespaceCount: namespaces.length,
        successCount: queryResponses.length,
        failureCount: queryFailures.length,
        rateLimitFallbackCount: rateLimitedOutcomes.length,
      })

      if (queryResponses.length === 0) throw queryFailures[0]
      if (
        queryFailures.length > 0 &&
        !queryResponses.some(hasRetrievalEvidence)
      ) {
        throw queryFailures[0]
      }
      return mergeRetrievalResponses(
        queryResponses,
        retrievalPlan,
        getAgenticMergedEvidenceLimits({
          namespaceCount: queryResponses.length,
          topK: queryInput.topK,
        }),
      )
    }

    const generatedAnswer = yield* Effect.tryPromise(() =>
      input.generateAnswer({
        question,
        messages: input.messages,
        sources: input.sources,
        excludedSourceIds: input.excludedSourceIds,
        searchSources,
        knowhereTools: notebookKnowhereTools.createRuntime({
          namespace: input.namespace,
          sources: input.sources,
          excludedSourceIds: input.excludedSourceIds,
          searchSources,
          knowledge: input.knowledge,
          remoteDocumentClient: input.remoteDocumentClient,
        }),
        ...(input.inspectImages ? { inspectImages: input.inspectImages } : {}),
      }),
    )

    logger.info("chat-agent: answer generated", {
      answerLength: generatedAnswer.manifest.text.length,
      retrievalCallCount: retrievalResponses.length,
      citationCount: generatedAnswer.manifest.citations.length,
      finalized: generatedAnswer.trace.finalized,
    })

    const rawResults = yield* Effect.tryPromise(() =>
      hydrateMissingCitationPageMetadata({
        results: selectCitationRawResults({
          generatedAnswer,
        }),
        ledgerChunks: generatedAnswer.trace.ledger.chunks,
        knowledge: input.knowledge,
      }),
    )
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
        hardenChatAssetUrl: input.hardenChatAssetUrl,
      }),
    )
    const pageCitationResults = yield* Effect.tryPromise(() =>
      enrichRetrievalResultsWithPageCitationAssetUrls({
        results: enrichedResults,
        sources: input.sources,
        hardenChatAssetUrl: input.hardenChatAssetUrl,
      }),
    )
    const artifacts = toChatArtifactViewsFromHarness(generatedAnswer, input.sources)
    const hardenedMedia = yield* Effect.tryPromise(() =>
      hardenAnswerMediaAssetUrls({
        input,
        results: pageCitationResults,
        artifacts,
      }),
    )
    const answer = sanitizeGeneratedAnswer({
      answer: generatedAnswer.manifest.text,
      results: getGeneratedAnswerSanitizerResults({
        rawResults,
        enrichedResults,
        pageCitationResults,
        hardenedResults: hardenedMedia.results,
        artifacts,
        hardenedArtifacts: hardenedMedia.artifacts,
      }),
    })
    const displayArtifacts = hardenedMedia.artifacts ?? []
    logger.info("chat-agent: answer complete", {
      answerLength: answer.length,
      citationCount: hardenedMedia.results.length,
      artifactCount: displayArtifacts.length,
    })
    return {
      answer,
      citations: toChatCitationViews(hardenedMedia.results, answer),
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
  const highlightsByRef = new Map(
    (result.trace.imageHighlights ?? []).map(
      (page) => [page.ref, page.regions] as const,
    ),
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
            highlightsByRef,
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
  readonly highlightsByRef: ReadonlyMap<string, readonly ChatImageHighlightBox[]>
  readonly sources: readonly AnswerQuestionInput["sources"][number][]
}): ChatArtifactView | null {
  const asset = input.assetsByRef.get(input.artifact.ref)
  if (asset) {
    return toChatArtifactView({
      artifact: input.artifact,
      asset,
      highlightRegions: input.highlightsByRef.get(asset.ref),
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
        highlightRegions:
          input.highlightsByRef.get(chunkAsset.ref) ??
          input.highlightsByRef.get(input.artifact.ref),
        sources: input.sources,
      })
    : null
}

function toChatArtifactView(input: {
  readonly artifact: OutputArtifact
  readonly asset: EvidenceAsset
  readonly highlightRegions?: readonly ChatImageHighlightBox[]
  readonly sources: readonly AnswerQuestionInput["sources"][number][]
}): ChatArtifactView {
  const source = normalizeHarnessSource(input.asset.source, input.sources)
  return {
    type: input.artifact.type,
    ref: input.artifact.ref,
    display: input.artifact.display,
    reason: input.artifact.reason,
    ...(input.asset.assetUrl ? { assetUrl: input.asset.assetUrl } : {}),
    label: input.asset.label,
    ...(input.highlightRegions && input.highlightRegions.length > 0
      ? { highlightRegions: input.highlightRegions }
      : {}),
    citation: {
      chunkType: input.asset.type,
      score: null,
      ...(input.asset.assetUrl ? { assetUrl: input.asset.assetUrl } : {}),
      source,
    },
  }
}

function normalizeHarnessSource(
  source: EvidenceChunk["source"],
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
  readonly results: readonly HardenableRetrievalResult[]
  readonly artifacts?: readonly ChatArtifactView[]
}

async function hardenAnswerMediaAssetUrls({
  input,
  results,
  artifacts,
}: AnswerMediaAssetHardeningInput): Promise<{
  readonly results: HardenableRetrievalResult[]
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
  readonly pageCitationResults: readonly HardenableRetrievalResult[]
  readonly hardenedResults: readonly HardenableRetrievalResult[]
  readonly artifacts?: readonly ChatArtifactView[]
  readonly hardenedArtifacts?: readonly ChatArtifactView[]
}

function getGeneratedAnswerSanitizerResults({
  rawResults,
  enrichedResults,
  pageCitationResults,
  hardenedResults,
  artifacts,
  hardenedArtifacts,
}: GeneratedAnswerSanitizerResultsInput): RetrievalResult[] {
  return [
    ...rawResults,
    ...enrichedResults,
    ...toPageCitationSanitizerResults(pageCitationResults),
    ...hardenedResults,
    ...toPageCitationSanitizerResults(hardenedResults),
    ...toArtifactSanitizerResults(artifacts),
    ...toArtifactSanitizerResults(hardenedArtifacts),
  ]
}

function toPageCitationSanitizerResults(
  results: readonly HardenableRetrievalResult[],
): RetrievalResult[] {
  return results.flatMap((result): RetrievalResult[] => {
    if (!result.pageCitationAssetUrl) return []

    return [
      {
        content: result.content,
        chunkType: result.chunkType,
        score: result.score,
        assetUrl: result.pageCitationAssetUrl,
        source: result.source,
      },
    ]
  })
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
    if (artifact.citation?.pageCitationAssetUrl) {
      results.push(
        toArtifactSanitizerResult({
          assetUrl: artifact.citation.pageCitationAssetUrl,
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
    results: response.results
      .slice(0, KNOWHERE_RESPONSE_LOG_ITEM_LIMIT)
      .map(formatKnowhereResultChunkForLog),
    referencedChunks: response.referencedChunks
      .slice(0, KNOWHERE_RESPONSE_LOG_ITEM_LIMIT)
      .map(formatKnowhereReferencedChunkForLog),
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

function queryRetrievalNamespaces(input: {
  readonly namespaces: readonly string[]
  readonly queryInput: AgenticRetrievalQuery
  readonly answerInput: AnswerQuestionInput
  readonly fallbackQuestion: string
  readonly retrievalPlan: AgenticRetrievalPlan
  readonly concurrency: number
  readonly mode: RetrievalNamespaceQueryMode
}): Promise<RetrievalNamespaceQueryOutcome[]> {
  return Effect.runPromise(
    Effect.all(
      input.namespaces.map((namespace) =>
        Effect.promise(() =>
          queryRetrievalNamespace({
            namespace,
            queryInput: input.queryInput,
            answerInput: input.answerInput,
            fallbackQuestion: input.fallbackQuestion,
            retrievalPlan: input.retrievalPlan,
            mode: input.mode,
          }),
        ),
      ),
      { concurrency: input.concurrency },
    ),
  )
}

async function queryRetrievalNamespace(input: {
  readonly namespace: string
  readonly queryInput: AgenticRetrievalQuery
  readonly answerInput: AnswerQuestionInput
  readonly fallbackQuestion: string
  readonly retrievalPlan: AgenticRetrievalPlan
  readonly mode: RetrievalNamespaceQueryMode
}): Promise<RetrievalNamespaceQueryOutcome> {
  const startedAt = Date.now()
  const retrievalQueryParams = buildRetrievalQueryParams({
    input: input.queryInput,
    fallbackQuestion: input.fallbackQuestion,
    namespace: input.namespace,
    useAgentic: input.answerInput.useAgentic ?? true,
    sources: input.answerInput.sources,
    excludedSourceIds: input.answerInput.excludedSourceIds,
  })
  logger.info("chat-agent: searchSources start", {
    namespace: input.namespace,
    query: retrievalQueryParams.query,
    topK: retrievalQueryParams.topK,
    useAgentic: retrievalQueryParams.useAgentic,
    dataType: retrievalQueryParams.dataType ?? null,
    signalPathCount: retrievalQueryParams.signalPaths?.length ?? 0,
    filterMode: retrievalQueryParams.filterMode ?? null,
    threshold: retrievalQueryParams.threshold ?? null,
    targetContent: input.retrievalPlan.targetContent,
    purpose: input.retrievalPlan.purpose,
    mode: input.mode,
  })

  try {
    const response = await input.answerInput.retrieval.query(retrievalQueryParams)
    logger.info("chat-agent: searchSources ok", {
      namespace: input.namespace,
      query: response.query,
      durationMs: Date.now() - startedAt,
      resultCount: response.results.length,
      referencedChunkCount: response.referencedChunks.length,
      stopReason: response.stopReason ?? null,
      failureReason: response.failureReason ?? null,
      targetContent: input.retrievalPlan.targetContent,
      mode: input.mode,
    })
    logger.info("chat-agent: knowhere query response", {
      durationMs: Date.now() - startedAt,
      response: formatKnowhereQueryResponseForLog(response),
      mode: input.mode,
    })
    return {
      status: "success",
      namespace: input.namespace,
      response,
    }
  } catch (error) {
    logger.error("chat-agent: searchSources failed", {
      namespace: input.namespace,
      query: retrievalQueryParams.query,
      durationMs: Date.now() - startedAt,
      error: formatUnknownError(error),
      targetContent: input.retrievalPlan.targetContent,
      mode: input.mode,
      rateLimited: isRateLimitError(error),
    })
    return {
      status: "failure",
      namespace: input.namespace,
      error,
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  const statusCode =
    getUnknownProperty(error, "statusCode") ??
    getUnknownProperty(error, "status")
  if (statusCode === 429 || statusCode === "429") return true

  const body = getUnknownProperty(error, "body")
  const bodyError = getUnknownProperty(body, "error")
  return [
    getUnknownProperty(error, "name"),
    getUnknownProperty(error, "code"),
    getUnknownProperty(error, "message"),
    getUnknownProperty(body, "message"),
    getUnknownProperty(bodyError, "code"),
    getUnknownProperty(bodyError, "message"),
  ].some(
    (value) =>
      typeof value === "string" &&
      /\b429\b|rate[\s_-]?limit|too many concurrent|resource_exhausted/i.test(
        value,
      ),
  )
}

function getUnknownProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function getRetrievalNamespaces(input: AnswerQuestionInput): readonly string[] {
  const candidates =
    input.namespaces && input.namespaces.length > 0
      ? input.namespaces
      : [input.namespace]
  const namespaces: string[] = []

  for (const namespace of candidates) {
    if (namespaces.includes(namespace)) continue
    namespaces.push(namespace)
  }

  return namespaces
}

function mergeRetrievalResponses(
  responses: readonly RetrievalQueryResponse[],
  retrievalPlan: AgenticRetrievalPlan,
  evidenceLimits: AgenticMergedEvidenceLimits,
): AgenticRetrievalResponse {
  const [first] = responses
  if (!first) {
    throw new Error("No retrieval responses to merge.")
  }

  const statusResponses = getRetrievalStatusResponses(responses)
  const results = responses
    .flatMap((response) =>
      response.results.slice(0, evidenceLimits.resultCountPerResponse),
    )
    .slice(0, evidenceLimits.resultCount)
  const referencedChunks = responses
    .flatMap((response) =>
      response.referencedChunks.slice(
        0,
        evidenceLimits.referencedChunkCountPerResponse,
      ),
    )
    .slice(0, evidenceLimits.referencedChunkCount)
  const evidenceTexts = responses
    .map((response) => response.evidenceText)
    .filter((value): value is string => Boolean(value))
    .map(truncateAgenticModelText)
  const answerTexts = responses
    .map((response) => response.answerText)
    .filter((value): value is string => Boolean(value))
    .map(truncateAgenticModelText)

  return {
    ...first,
    namespace: responses.map((response) => response.namespace).join(","),
    routerUsed: joinResponseText(responses.map((response) => response.routerUsed)) ?? "",
    answerText: answerTexts.length > 0 ? answerTexts.join("\n\n") : null,
    evidenceText: evidenceTexts.length > 0 ? evidenceTexts.join("\n\n") : null,
    stopReason: joinResponseText(
      statusResponses.map((response) => response.stopReason),
    ),
    failureReason: joinResponseText(
      statusResponses.map((response) => response.failureReason),
    ),
    decisionTrace: statusResponses.flatMap(
      (response) => response.decisionTrace ?? [],
    ),
    results,
    referencedChunks,
    retrievalPlan,
  }
}

function getAgenticMergedEvidenceLimits(input: {
  readonly namespaceCount: number
  readonly topK: number | undefined
}): AgenticMergedEvidenceLimits {
  const namespaceCount = Math.max(input.namespaceCount, 1)
  const perResponseCount = normalizeTopK(input.topK)
  const requestedCount = perResponseCount * namespaceCount
  return {
    resultCountPerResponse: perResponseCount,
    referencedChunkCountPerResponse: perResponseCount,
    resultCount: Math.min(requestedCount, MAX_AGENTIC_MERGED_RESULT_COUNT),
    referencedChunkCount: Math.min(
      requestedCount,
      MAX_AGENTIC_MERGED_REFERENCED_CHUNK_COUNT,
    ),
  }
}

function truncateAgenticModelText(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_AGENTIC_MERGED_TEXT_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_AGENTIC_MERGED_TEXT_CHARS)}\n...[truncated]`
}

function getRetrievalStatusResponses(
  responses: readonly RetrievalQueryResponse[],
): readonly RetrievalQueryResponse[] {
  const responsesWithEvidence = responses.filter(hasRetrievalEvidence)
  return responsesWithEvidence.length > 0 ? responsesWithEvidence : responses
}

function hasRetrievalEvidence(response: RetrievalQueryResponse): boolean {
  return (
    response.results.length > 0 ||
    response.referencedChunks.length > 0 ||
    Boolean(response.evidenceText?.trim()) ||
    Boolean(response.answerText?.trim())
  )
}

function joinResponseText(
  values: readonly (string | null | undefined)[],
): string | null {
  const uniqueValues: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || uniqueValues.includes(normalized)) continue
    uniqueValues.push(normalized)
  }

  return uniqueValues.length > 0 ? uniqueValues.join(",") : null
}

function buildRetrievalQueryParams(input: {
  readonly input: AgenticRetrievalQuery
  readonly fallbackQuestion: string
  readonly namespace: string
  readonly useAgentic: boolean
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
    useAgentic: input.useAgentic,
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
 * cite), resolved against the evidence ledger. If the manifest has no citations,
 * only displayed artifacts produce citation chips; arbitrary retrieval results
 * stay hidden so Notebook does not imply support from an unselected source.
 */
function selectCitationRawResults(input: {
  readonly generatedAnswer: HarnessRunResult
}): RetrievalResult[] {
  const curated = mapManifestCitationsToResults(input.generatedAnswer)
  if (curated.length > 0) return curated
  const displayedArtifacts = mapDisplayedManifestArtifactsToResults(
    input.generatedAnswer,
  )
  if (displayedArtifacts.length > 0) return displayedArtifacts
  return []
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

  for (const citation of result.manifest.citations) {
    const chunk =
      chunksByRef.get(citation.ref) ??
      resolveChunkForAssetRef(citation.ref, assetsByRef, chunksByRef)
    if (!chunk) continue

    const retrievalResult = toRetrievalResultFromEvidenceChunk(
      mergeChunkPageMetadata(chunk, result.trace.ledger.chunks),
    )
    const highlightRegions = getHighlightRegionsForChunk(
      chunk,
      result.trace.imageHighlights,
      chunksByRef,
      assetsByRef,
    )
    const resultWithHighlights =
      highlightRegions && highlightRegions.length > 0
        ? { ...retrievalResult, highlightRegions }
        : retrievalResult
    results.push(resultWithHighlights as RetrievalResult)
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

function getHighlightRegionsForChunk(
  chunk: EvidenceChunk,
  imageHighlights: HarnessRunResult["trace"]["imageHighlights"],
  chunksByRef: ReadonlyMap<string, EvidenceChunk>,
  assetsByRef: ReadonlyMap<string, EvidenceAsset>,
): ChatImageHighlightBox[] | undefined {
  if (!imageHighlights || imageHighlights.length === 0) return undefined

  const candidateRefs = new Set([chunk.ref])
  const assetRef = resolveCitationImageAssetRef(
    chunk,
    chunksByRef,
    assetsByRef,
  )
  if (assetRef) candidateRefs.add(assetRef)
  const canonicalAssetKey = assetRef
    ? getCanonicalCitationAssetKey(assetRef, chunksByRef, assetsByRef)
    : null

  for (const page of imageHighlights) {
    const isDirectMatch = candidateRefs.has(page.ref)
    const isCanonicalMatch =
      canonicalAssetKey !== null &&
      getCanonicalCitationAssetKey(page.ref, chunksByRef, assetsByRef) ===
        canonicalAssetKey
    if ((!isDirectMatch && !isCanonicalMatch) || page.regions.length === 0) {
      continue
    }
    return [...page.regions]
  }

  return undefined
}

function resolveCitationImageAssetRef(
  chunk: EvidenceChunk,
  chunksByRef: ReadonlyMap<string, EvidenceChunk>,
  assetsByRef: ReadonlyMap<string, EvidenceAsset>,
): string | null {
  if (chunk.assetRef && assetsByRef.get(chunk.assetRef)?.type === "image") {
    return chunk.assetRef
  }
  if (!chunk.chunkId) return null

  const sibling = Array.from(chunksByRef.values()).find(
    (candidate) =>
      candidate.ref !== chunk.ref &&
      candidate.chunkId === chunk.chunkId &&
      candidate.source.documentId === chunk.source.documentId &&
      candidate.assetRef !== undefined &&
      assetsByRef.get(candidate.assetRef)?.type === "image",
  )
  return sibling?.assetRef ?? null
}

function getCanonicalCitationAssetKey(
  assetRef: string,
  chunksByRef: ReadonlyMap<string, EvidenceChunk>,
  assetsByRef: ReadonlyMap<string, EvidenceAsset>,
): string {
  const asset = assetsByRef.get(assetRef)
  if (!asset) return assetRef
  return getCanonicalImageAssetKey(asset, chunksByRef)
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

        const retrievalResult = toRetrievalResultFromEvidenceChunk(
          mergeChunkPageMetadata(chunk, result.trace.ledger.chunks),
        )
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

    const retrievalResult = toRetrievalResultFromEvidenceChunk(
      mergeChunkPageMetadata(chunk, result.trace.ledger.chunks),
    )
    const key = getRetrievalResultKey(retrievalResult)
    if (seenKeys.has(key)) continue

    seenKeys.add(key)
    results.push(retrievalResult)
    if (results.length >= MAX_CITATION_RESULTS) break
  }

  return results
}

function mergeChunkPageMetadata(
  chunk: EvidenceChunk,
  ledgerChunks: readonly EvidenceChunk[],
): EvidenceChunk {
  if (hasResolvablePageNumber(chunk) || !chunk.chunkId) return chunk

  const donor = ledgerChunks.find(
    (candidate) =>
      candidate.ref !== chunk.ref &&
      candidate.chunkId === chunk.chunkId &&
      hasResolvablePageNumber(candidate),
  )
  if (!donor?.metadata) return chunk

  return {
    ...chunk,
    metadata: { ...donor.metadata, ...chunk.metadata },
  }
}

async function hydrateMissingCitationPageMetadata(input: {
  readonly results: readonly RetrievalResult[]
  readonly ledgerChunks: readonly EvidenceChunk[]
  readonly knowledge: AnswerQuestionInput["knowledge"]
}): Promise<RetrievalResult[]> {
  const results = input.results.map((result) => {
    const donor = input.ledgerChunks.find(
      (chunk) =>
        Boolean(result.chunkId) &&
        chunk.chunkId === result.chunkId &&
        hasResolvablePageNumber(chunk),
    )
    if (!donor?.metadata || resolvePageCitationPageNumber(result)) {
      return result
    }
    return {
      ...result,
      metadata: { ...donor.metadata, ...result.metadata },
    }
  })

  const knowledge = input.knowledge
  if (!knowledge) return results

  return Promise.all(
    results.map((result) =>
      hydrateResultPageMetadataFromKnowledge(result, knowledge),
    ),
  )
}

async function hydrateResultPageMetadataFromKnowledge(
  result: RetrievalResult,
  knowledge: NonNullable<AnswerQuestionInput["knowledge"]>,
): Promise<RetrievalResult> {
  if (resolvePageCitationPageNumber(result)) return result
  const documentId = result.source.documentId
  const chunkId = result.chunkId
  if (!documentId || !chunkId) return result

  try {
    const response = await knowledge.readChunks({ documentId, chunkId })
    const chunk = response.chunks[0]
    if (!chunk) return result
    return {
      ...result,
      metadata: {
        ...(chunk.metadata ?? {}),
        ...(chunk.pageNumbers && chunk.pageNumbers.length > 0
          ? { pageNums: chunk.pageNumbers }
          : {}),
        ...result.metadata,
      },
    }
  } catch {
    return result
  }
}

function hasResolvablePageNumber(chunk: EvidenceChunk): boolean {
  return (
    resolvePageCitationPageNumber({
      content: chunk.content,
      chunkType: chunk.chunkType,
      score: chunk.score,
      metadata: chunk.metadata,
      source: {
        documentId: chunk.source.documentId ?? undefined,
        sourceFileName: chunk.source.sourceFileName ?? undefined,
        sectionPath: chunk.source.sectionPath ?? undefined,
      },
    }) !== undefined
  )
}

function toRetrievalResultFromEvidenceChunk(
  chunk: EvidenceChunk,
): RetrievalResult {
  return {
    ...(chunk.chunkId ? { chunkId: chunk.chunkId } : {}),
    content: chunk.content,
    chunkType: chunk.chunkType,
    score: chunk.score,
    ...(chunk.assetUrl ? { assetUrl: chunk.assetUrl } : {}),
    ...(chunk.sourceChunkPath ? { sourceChunkPath: chunk.sourceChunkPath } : {}),
    ...(chunk.filePath ? { filePath: chunk.filePath } : {}),
    ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
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
