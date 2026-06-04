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
  removeRetrievedMediaAssetUrls,
} from "./media-assets"

const DEFAULT_TOP_K = 8
const MAX_AGENTIC_TOP_K = 12
const MAX_CITATION_RESULTS = 20
const DEFAULT_CHUNK_READ_LIMIT = 2_000
const MAX_CHUNK_READ_LIMIT = 4_000
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."

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
        })
        return { ...response, chunkReferences }
      } catch (error) {
        logger.error("chat-agent: searchSources failed", {
          query: retrievalQueryParams.query,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
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
    const answer = removeRetrievedMediaAssetUrls(generatedAnswer, results)
    logger.info("chat-agent: answer complete", {
      answerLength: answer.length,
      citationCount: results.length,
    })
    return {
      answer,
      citations: toChatCitationViews(results, answer),
    }
  })

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
  return {
    namespace: input.namespace,
    query,
    topK: normalizeTopK(input.input.topK),
    useAgentic: true,
    ...(input.input.dataType ? { dataType: input.input.dataType } : {}),
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
