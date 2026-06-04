import { Effect } from "effect"
import type {
  RetrievalQueryParams,
  RetrievalQueryResponse,
  RetrievalResult,
  RetrievalSource,
} from "@ontos-ai/knowhere-sdk"

import { logger } from "@/lib/logger"
import type { ChatCitationView } from "@/domains/chat/types"
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
  ReadRetrievedChunkInput,
  ReadRetrievedChunkResult,
  RetrievedChunkReference,
} from "./contracts"
import {
  excludeDocuments,
  normalizeRetrievalQuery,
} from "./retrieval"
import {
  enrichRetrievalResultsWithAssetUrls,
  isImageAssetUrl,
  removeRetrievedMediaAssetUrls,
} from "./media-assets"

const DEFAULT_TOP_K = 8
const MAX_AGENTIC_TOP_K = 12
const MAX_CITATION_RESULTS = 20
const DEFAULT_CHUNK_READ_LIMIT = 2_000
const MAX_CHUNK_READ_LIMIT = 4_000
const KNOWHERE_RESPONSE_TEXT_LOG_LIMIT = 200
const KNOWHERE_CHUNK_LOG_LIMIT = 100
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

type StoredRetrievedChunk = {
  id: string
  chunkId: string | null
  kind: RetrievedChunkReference["kind"]
  resultIndex: number | null
  content: string
  chunkType: string
  score: number | null
  source: RetrievalSource
  hasAssetUrl: boolean
}

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
  buildAgenticChatSystemPrompt,
  buildGroundedPrompt,
  buildRetrievalQueryPrompt,
  generateAgenticGroundedAnswer,
  generateAgenticGroundedAnswerEffect,
  generateContextualRetrievalQuery,
  generateContextualRetrievalQueryEffect,
  generateGroundedAnswer,
  generateGroundedAnswerEffect,
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
    const retrievedChunkContext = createRetrievedChunkContext()

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
        const chunkReferences = retrievedChunkContext.registerResponse({
          response,
          responseIndex: retrievalResponses.length,
        })
        logger.info("chat-agent: searchSources ok", {
          query: response.query,
          durationMs: Date.now() - startedAt,
          resultCount: response.results.length,
          referencedChunkCount: response.referencedChunks.length,
          readableChunkCount: chunkReferences.length,
          truncatedChunkCount: chunkReferences.filter(
            (reference): boolean => reference.contentTruncated,
          ).length,
          stopReason: response.stopReason ?? null,
          failureReason: response.failureReason ?? null,
          targetContent: retrievalPlan.targetContent,
        })
        logger.info("chat-agent: knowhere query response", {
          durationMs: Date.now() - startedAt,
          response: formatKnowhereQueryResponseForLog(response),
        })
        return { ...response, chunkReferences, retrievalPlan }
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

    const readRetrievedChunk = async (
      readInput: ReadRetrievedChunkInput,
    ): Promise<ReadRetrievedChunkResult> => {
      const result = retrievedChunkContext.read(readInput)
      logger.info("chat-agent: readRetrievedChunk", {
        id: result.id,
        found: result.found,
        offset: result.offset,
        limit: result.limit,
        contentLength: result.contentLength,
        returnedLength: result.contentSlice.length,
        hasMoreContent: result.hasMoreContent,
        nextOffset: result.nextOffset,
      })
      return result
    }

    const generatedAnswer = yield* Effect.tryPromise(() =>
      input.generateAnswer({
        question,
        messages: input.messages,
        sources: input.sources,
        excludedSourceIds: input.excludedSourceIds,
        searchSources,
        readRetrievedChunk,
      }),
    )

    logger.info("chat-agent: answer generated", {
      answerLength: generatedAnswer.length,
      retrievalCallCount: retrievalResponses.length,
      registeredChunkCount: retrievedChunkContext.size(),
    })

    const rawResults = collectRetrievalResults(retrievalResponses, input.sources)
    if (rawResults.length === 0 && generatedAnswer.trim().length === 0) {
      return { answer: NO_RESULTS_ANSWER, citations: [] as ChatCitationView[] }
    }

    const results = yield* Effect.tryPromise(() =>
      enrichRetrievalResultsWithAssetUrls({
        results: useNotebookSourceTitles(rawResults, input.sources),
        sources: input.sources,
        loadSourceAssetUrls: input.loadSourceAssetUrls,
        evidenceText: formatRetrievalEvidenceText(retrievalResponses),
      }),
    )
    const answer = sanitizeGeneratedAnswer({
      answer: generatedAnswer,
      question,
      results,
    })
    const citationResults = selectCitationResultsForAnswer({
      question,
      results,
    })
    logger.info("chat-agent: answer complete", {
      answerLength: answer.length,
      citationCount: citationResults.length,
    })
    return {
      answer,
      citations: toChatCitationViews(citationResults, answer),
    }
  })

type GeneratedAnswerSanitizerInput = {
  readonly answer: string
  readonly question: string
  readonly results: readonly RetrievalResult[]
}

function sanitizeGeneratedAnswer({
  answer,
  question,
  results,
}: GeneratedAnswerSanitizerInput): string {
  const sanitizedAnswer = removeRetrievedMediaAssetUrls(answer, results)

  if (
    shouldUseConciseImageRequestAnswer({
      answer: sanitizedAnswer,
      question,
      results,
    })
  ) {
    return buildConciseImageRequestAnswer(question)
  }

  return sanitizedAnswer
}

function shouldUseConciseImageRequestAnswer({
  answer,
  question,
  results,
}: GeneratedAnswerSanitizerInput): boolean {
  return (
    isShowOrSendImageRequest(question) &&
    !isExplicitPersonalDetailRequest(question) &&
    hasImageCitationResult(results) &&
    shouldSimplifyImageRequestAnswer(answer)
  )
}

function selectCitationResultsForAnswer(input: {
  readonly question: string
  readonly results: readonly RetrievalResult[]
}): readonly RetrievalResult[] {
  if (!isShowOrSendImageRequest(input.question)) return input.results

  const imageResults = input.results.filter(isImageCitationResult)
  if (imageResults.length === 0) return input.results

  const focusedImageResults = filterFocusedImageCitationResults(
    input.question,
    imageResults,
  )
  return focusedImageResults.length > 0 ? focusedImageResults : imageResults
}

function hasImageCitationResult(results: readonly RetrievalResult[]): boolean {
  return results.some(isImageCitationResult)
}

function isImageCitationResult(result: RetrievalResult): boolean {
  const assetUrl = result.assetUrl?.trim()
  if (!assetUrl) return false

  return result.chunkType.toLowerCase() === "image" || isImageAssetUrl(assetUrl)
}

function filterFocusedImageCitationResults(
  question: string,
  results: readonly RetrievalResult[],
): readonly RetrievalResult[] {
  const labelPattern = getFocusedImageCitationLabelPattern(question)
  if (!labelPattern) return results

  return results.filter((result): boolean =>
    labelPattern.test(getImageCitationLabel(result)),
  )
}

function getFocusedImageCitationLabelPattern(question: string): RegExp | null {
  if (/身份证|公民身份|居民身份证|\bid card\b|\bidentity card\b/iu.test(question)) {
    return /身份证|居民身份证|\bid card\b|\bidentity card\b/iu
  }

  return null
}

function getImageCitationLabel(result: RetrievalResult): string {
  return [
    result.source.sourceFileName,
    result.source.sectionPath,
    getAssetPathFromCitationUrl(result.assetUrl),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
}

function getAssetPathFromCitationUrl(assetUrl: string | undefined): string | null {
  if (!assetUrl) return null

  try {
    return decodeURIComponent(new URL(assetUrl).pathname)
  } catch {
    return assetUrl
  }
}

function isShowOrSendImageRequest(question: string): boolean {
  const normalizedQuestion = question.toLowerCase()
  const hasImageTerm =
    /图片|照片|图像|截图|身份证|\bimage\b|\bimages\b|\bphoto\b|\bphotos\b|\bpicture\b|\bpictures\b|\bscreenshot\b|\bid card\b|\bidentity card\b/u.test(
      normalizedQuestion,
    )
  const hasActionTerm =
    /请将|请把|发送|发给我|发来|给我看|展示|显示|看一下|\bshow\b|\bsend\b|\bdisplay\b|\battach\b|\bgive me\b/u.test(
      normalizedQuestion,
    )

  return hasImageTerm && hasActionTerm
}

function isExplicitPersonalDetailRequest(question: string): boolean {
  return /号码|身份证号|身份号码|住址|地址|出生|有效期限|签发机关|姓名|是什么|多少|\bid number\b|\bidentity number\b|\baddress\b|\bbirth\b|\bissuer\b|\bvalid/u.test(
    question.toLowerCase(),
  )
}

function containsPersonalDetailField(answer: string): boolean {
  return /公民身份号码|身份号码|身份证号|身份证号码|住址|地址|出生日期|出生|有效期限|签发机关|性别|民族|姓名|\bid number\b|\bidentity number\b|\baddress\b|\bdate of birth\b|\bbirth date\b|\bissuer\b|\bissuing authority\b|\bvalid until\b|\bvalid through\b/i.test(
    answer,
  )
}

function shouldSimplifyImageRequestAnswer(answer: string): boolean {
  const trimmedAnswer = answer.trim()
  return (
    containsPersonalDetailField(trimmedAnswer) ||
    containsMarkdownList(trimmedAnswer) ||
    containsSourceIndexReference(trimmedAnswer) ||
    trimmedAnswer.length > getConciseImageAnswerLengthLimit(trimmedAnswer)
  )
}

function containsMarkdownList(value: string): boolean {
  return /\n\s*[-*]\s+/u.test(value)
}

function containsSourceIndexReference(value: string): boolean {
  return /\bSource\s+\d+\b/iu.test(value)
}

function getConciseImageAnswerLengthLimit(answer: string): number {
  return containsCjkText(answer) ? 120 : 220
}

function buildConciseImageRequestAnswer(question: string): string {
  if (containsCjkText(question)) {
    return question.includes("身份证")
      ? "已找到相关身份证图片，见下方图片。"
      : "已找到相关图片，见下方图片。"
  }

  return "I found the relevant image. See the image below."
}

function containsCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
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

function createRetrievedChunkContext(): {
  registerResponse(input: {
    readonly response: RetrievalQueryResponse
    readonly responseIndex: number
  }): readonly RetrievedChunkReference[]
  read(input: ReadRetrievedChunkInput): ReadRetrievedChunkResult
  size(): number
} {
  const chunksById = new Map<string, StoredRetrievedChunk>()

  function storeChunk(chunk: StoredRetrievedChunk): void {
    chunksById.set(chunk.id, chunk)
    if (chunk.chunkId && chunk.chunkId !== chunk.id) {
      chunksById.set(chunk.chunkId, chunk)
    }
  }

  return {
    registerResponse(input): readonly RetrievedChunkReference[] {
      const references: RetrievedChunkReference[] = []
      input.response.results.forEach((result, index): void => {
        const resultIndex = index + 1
        const chunkId = getRetrievalResultChunkId(result)
        const id = chunkId ?? `search_${input.responseIndex}_result_${resultIndex}`
        const storedChunk: StoredRetrievedChunk = {
          id,
          chunkId,
          kind: "result",
          resultIndex,
          content: result.content,
          chunkType: result.chunkType,
          score: result.score,
          source: result.source,
          hasAssetUrl: Boolean(result.assetUrl),
        }
        storeChunk(storedChunk)
        references.push(toRetrievedChunkReference(storedChunk))
      })

      input.response.referencedChunks.forEach((chunk, index): void => {
        const id = chunk.chunkId || `search_${input.responseIndex}_reference_${index + 1}`
        const existingChunk = chunksById.get(id)
        if (existingChunk) {
          references.push(toRetrievedChunkReference(existingChunk))
          return
        }

        const storedChunk: StoredRetrievedChunk = {
          id,
          chunkId: chunk.chunkId || null,
          kind: "referencedChunk",
          resultIndex: null,
          content: "",
          chunkType: chunk.chunkType,
          score: null,
          source: {
            documentId: chunk.documentId,
            sourceFileName: null,
            sectionPath: chunk.sectionPath,
          },
          hasAssetUrl: Boolean(chunk.assetUrl),
        }
        storeChunk(storedChunk)
        references.push(toRetrievedChunkReference(storedChunk))
      })

      return references
    },
    read(input): ReadRetrievedChunkResult {
      const offset = normalizeChunkReadOffset(input.offset)
      const limit = normalizeChunkReadLimit(input.limit)
      const chunk = chunksById.get(input.id)
      if (!chunk) {
        return {
          id: input.id,
          chunkId: null,
          found: false,
          chunkType: null,
          score: null,
          source: null,
          hasAssetUrl: false,
          offset,
          limit,
          contentLength: 0,
          contentSlice: "",
          hasMoreContent: false,
          nextOffset: null,
        }
      }

      const boundedOffset = Math.min(offset, chunk.content.length)
      const endOffset = Math.min(boundedOffset + limit, chunk.content.length)
      return {
        id: chunk.id,
        chunkId: chunk.chunkId,
        found: true,
        chunkType: chunk.chunkType,
        score: chunk.score,
        source: chunk.source,
        hasAssetUrl: chunk.hasAssetUrl,
        offset: boundedOffset,
        limit,
        contentLength: chunk.content.length,
        contentSlice: chunk.content.slice(boundedOffset, endOffset),
        hasMoreContent: endOffset < chunk.content.length,
        nextOffset: endOffset < chunk.content.length ? endOffset : null,
      }
    },
    size(): number {
      return chunksById.size
    },
  }
}

function toRetrievedChunkReference(
  chunk: StoredRetrievedChunk,
): RetrievedChunkReference {
  const contentPreview = chunk.content.slice(0, DEFAULT_CHUNK_READ_LIMIT)
  return {
    id: chunk.id,
    chunkId: chunk.chunkId,
    kind: chunk.kind,
    resultIndex: chunk.resultIndex,
    chunkType: chunk.chunkType,
    score: chunk.score,
    source: chunk.source,
    hasAssetUrl: chunk.hasAssetUrl,
    contentLength: chunk.content.length,
    contentPreview,
    contentTruncated: contentPreview.length < chunk.content.length,
  }
}

function getRetrievalResultChunkId(result: RetrievalResult): string | null {
  const resultWithChunkId = result as RetrievalResult & {
    readonly chunkId?: string | null
  }
  return resultWithChunkId.chunkId?.trim() || null
}

function normalizeChunkReadOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return 0
  return Math.max(value, 0)
}

function normalizeChunkReadLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_CHUNK_READ_LIMIT
  }
  return Math.min(Math.max(value, 1), MAX_CHUNK_READ_LIMIT)
}

function normalizeTopK(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_TOP_K
  }
  return Math.min(Math.max(value, 1), MAX_AGENTIC_TOP_K)
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
