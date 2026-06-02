import type { RetrievalQueryParams, RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type { ChatCitationView } from "@/domains/chat/types"

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<RetrievalQueryResponse>
}

export type ChatHistoryMessage = {
  role: "user" | "assistant"
  content: string
  citations?: readonly ChatCitationView[]
}

export type GenerateRetrievalQuery = (input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
}) => Promise<string>

export type GenerateAnswer = (input: {
  question: string
  retrievalQuery: string
  messages: readonly ChatHistoryMessage[]
  evidenceText: string
}) => Promise<string>

export type AnswerQuestionInput = {
  question: string
  namespace: string
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  retrieval: RetrievalClient
  generateRetrievalQuery: GenerateRetrievalQuery
  generateAnswer: GenerateAnswer
  messages: readonly ChatHistoryMessage[]
}

export type AnswerQuestionResult = {
  answer: string
  citations: ChatCitationView[]
}

