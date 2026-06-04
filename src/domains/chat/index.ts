import { Effect } from "effect"

import type { ChatCitationView } from "@/domains/chat/types"
import {
  toChatCitationViews,
  useNotebookSourceTitles,
} from "./citations"
import type { AnswerQuestionInput, AnswerQuestionResult } from "./contracts"
import {
  excludeDocuments,
  normalizeRetrievalQuery,
} from "./retrieval"
import {
  enrichRetrievalResultsWithAssetUrls,
  formatRetrievedMediaAssetContext,
} from "./media-assets"

const DEFAULT_TOP_K = 8
const NO_RESULTS_ANSWER = "I couldn't find that in your sources."

export type {
  AnswerQuestionInput,
  AnswerQuestionResult,
  ChatHistoryMessage,
  GenerateAnswer,
  GenerateRetrievalQuery,
  RetrievalClient,
} from "./contracts"
export {
  buildGroundedPrompt,
  buildRetrievalQueryPrompt,
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
    const generatedQuery = yield* Effect.tryPromise(() =>
      input.generateRetrievalQuery({
        question,
        messages: input.messages,
        sources: input.sources,
        excludedSourceIds: input.excludedSourceIds,
      }),
    )
    const query = normalizeRetrievalQuery(generatedQuery, question)
    const response = yield* Effect.tryPromise(() =>
      input.retrieval.query({
        namespace: input.namespace,
        query,
        topK: DEFAULT_TOP_K,
        useAgentic: true,
        ...excludeDocuments(input.sources, input.excludedSourceIds),
      }),
    )

    const evidenceText = response.evidenceText ?? ""
    if (response.results.length === 0 && !evidenceText) {
      return { answer: NO_RESULTS_ANSWER, citations: [] as ChatCitationView[] }
    }

    const results = yield* Effect.tryPromise(() =>
      enrichRetrievalResultsWithAssetUrls({
        results: useNotebookSourceTitles(response.results, input.sources),
        sources: input.sources,
        loadSourceAssetUrls: input.loadSourceAssetUrls,
      }),
    )
    const mediaAssetContext = formatRetrievedMediaAssetContext(results)
    const generateAnswerInput = {
      question,
      retrievalQuery: query,
      messages: input.messages,
      evidenceText,
      ...(mediaAssetContext ? { mediaAssetContext } : {}),
    }
    const answer = yield* Effect.tryPromise(() =>
      input.generateAnswer(generateAnswerInput),
    )
    return {
      answer,
      citations: toChatCitationViews(results, answer),
    }
  })
