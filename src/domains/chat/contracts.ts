import type { RetrievalQueryParams, RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"
import type { LoadSourceAssetUrls } from "./media-assets"

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<RetrievalQueryResponse>
}

export type ChatHistoryMessage = {
  role: "user" | "assistant"
  content: string
  citations?: readonly ChatCitationView[]
}

export type AgenticRetrievalQuery = Pick<
  RetrievalQueryParams,
  | "query"
  | "topK"
  | "dataType"
  | "signalPaths"
  | "filterMode"
  | "threshold"
>

export type SearchSources = (
  input: AgenticRetrievalQuery,
) => Promise<RetrievalQueryResponse>

export type GenerateAnswer = (input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  searchSources: SearchSources
}) => Promise<string>

export type AnswerQuestionInput = {
  question: string
  namespace: string
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  retrieval: RetrievalClient
  generateAnswer: GenerateAnswer
  loadSourceAssetUrls?: LoadSourceAssetUrls
  messages: readonly ChatHistoryMessage[]
}

export type AnswerQuestionResult = {
  answer: string
  citations: ChatCitationView[]
}
