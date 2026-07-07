import type {
  Knowledge,
  RetrievalQueryParams,
  RetrievalQueryResponse,
} from "@ontos-ai/knowhere-sdk"

import type { Source } from "@/infrastructure/db/schema"
import type {
  HarnessRunResult,
  InspectImages,
  KnowhereToolRuntime,
} from "@/agent-harness"
import type {
  ChatArtifactView,
  ChatCitationView,
} from "@/domains/chat/types"
import type { HardenMediaAssetUrls } from "./media-asset-hardening"
import type { HardenChatAssetUrl } from "./media-assets"
import type { NotebookKnowhereRemoteDocumentClient } from "./knowhere-tools"

export type RetrievalClient = {
  query(params: RetrievalQueryParams): Promise<RetrievalQueryResponse>
}

export type ChatHistoryMessage = {
  role: "user" | "assistant"
  content: string
  citations?: readonly ChatCitationView[]
}

export type AgenticRetrievalTargetContent =
  | "all"
  | "text"
  | "image"
  | "table"
  | "text_image"
  | "text_table"

export type AgenticRetrievalPlan = {
  targetContent: AgenticRetrievalTargetContent
  purpose: string | null
}

export type AgenticRetrievalQuery = Pick<
  RetrievalQueryParams,
  "query" | "topK" | "signalPaths" | "filterMode" | "threshold"
> & {
  readonly targetContent?: AgenticRetrievalTargetContent
  readonly purpose?: string
}

export type AgenticRetrievalResponse = RetrievalQueryResponse & {
  retrievalPlan?: AgenticRetrievalPlan
}

export type SearchSources = (
  input: AgenticRetrievalQuery,
) => Promise<AgenticRetrievalResponse>

export type GenerateAnswer = (input: {
  question: string
  messages: readonly ChatHistoryMessage[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  searchSources: SearchSources
  knowhereTools?: KnowhereToolRuntime
  inspectImages?: InspectImages
}) => Promise<HarnessRunResult>

export type AnswerQuestionInput = {
  question: string
  namespace: string
  namespaces?: readonly string[]
  sources: readonly Source[]
  excludedSourceIds: readonly string[]
  retrieval: RetrievalClient
  knowledge?: Knowledge
  remoteDocumentClient?: NotebookKnowhereRemoteDocumentClient
  generateAnswer: GenerateAnswer
  hardenChatAssetUrl?: HardenChatAssetUrl
  hardenMediaAssetUrls?: HardenMediaAssetUrls
  inspectImages?: InspectImages
  messages: readonly ChatHistoryMessage[]
}

export type AnswerQuestionResult = {
  answer: string
  citations: ChatCitationView[]
  artifacts?: ChatArtifactView[]
}
