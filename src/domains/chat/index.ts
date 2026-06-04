import { Effect } from "effect"
import type {
  RetrievalQueryParams,
  RetrievalQueryResponse,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"

import type { ChatCitationView } from "@/domains/chat/types"
import {
  toChatCitationViews,
  useNotebookSourceTitles,
} from "./citations"
import type {
  AgenticRetrievalQuery,
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
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."

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

    const searchSources = async (
      queryInput: AgenticRetrievalQuery,
    ): Promise<RetrievalQueryResponse> => {
      const response = await input.retrieval.query(
        buildRetrievalQueryParams({
          input: queryInput,
          fallbackQuestion: question,
          namespace: input.namespace,
          sources: input.sources,
          excludedSourceIds: input.excludedSourceIds,
        }),
      )
      retrievalResponses.push(response)
      return response
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

    const rawResults = collectRetrievalResults(retrievalResponses, input.sources)
    if (rawResults.length === 0 && generatedAnswer.trim().length === 0) {
      return { answer: NO_RESULTS_ANSWER, citations: [] as ChatCitationView[] }
    }

    const results = yield* Effect.tryPromise(() =>
      enrichRetrievalResultsWithAssetUrls({
        results: useNotebookSourceTitles(rawResults, input.sources),
        sources: input.sources,
        loadSourceAssetUrls: input.loadSourceAssetUrls,
      }),
    )
    const answer = removeRetrievedMediaAssetUrls(generatedAnswer, results)
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
