import type {
  RetrievalQueryParams,
  RetrievalQueryResponse,
  RetrievalSource,
} from "@ontos-ai/knowhere-sdk"

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

export type AgenticRetrievalIntent =
  | "overview"
  | "entity"
  | "section"
  | "image"
  | "table"
  | "detail"
  | "citation"

export type AgenticRetrievalPlan = {
  intent: AgenticRetrievalIntent | null
  purpose: string | null
  priority: number | null
}

export type AgenticRetrievalDataTypeInput = number

export type AgenticRetrievalQuery = Pick<
  RetrievalQueryParams,
  "query" | "topK" | "signalPaths" | "filterMode" | "threshold"
> & {
  readonly dataType?: AgenticRetrievalDataTypeInput
  readonly intent?: AgenticRetrievalIntent
  readonly purpose?: string
  readonly priority?: number
}

export type RetrievedChunkReference = {
  id: string
  chunkId: string | null
  kind: "result" | "referencedChunk"
  resultIndex: number | null
  chunkType: string
  score: number | null
  source: RetrievalSource
  hasAssetUrl: boolean
  contentLength: number
  contentPreview: string
  contentTruncated: boolean
}

export type AgenticRetrievalResponse = RetrievalQueryResponse & {
  chunkReferences: readonly RetrievedChunkReference[]
  retrievalPlan?: AgenticRetrievalPlan
}

export type SearchSources = (
  input: AgenticRetrievalQuery,
) => Promise<AgenticRetrievalResponse>

export type ReadRetrievedChunkInput = {
  id: string
  offset?: number
  limit?: number
}

export type ReadRetrievedChunkResult = {
  id: string
  chunkId: string | null
  found: boolean
  chunkType: string | null
  score: number | null
  source: RetrievalSource | null
  hasAssetUrl: boolean
  offset: number
  limit: number
  contentLength: number
  contentSlice: string
  hasMoreContent: boolean
  nextOffset: number | null
}

export type ReadRetrievedChunk = (
  input: ReadRetrievedChunkInput,
) => Promise<ReadRetrievedChunkResult>

export type GenerateAnswer = (input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  searchSources: SearchSources
  readRetrievedChunk: ReadRetrievedChunk
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
