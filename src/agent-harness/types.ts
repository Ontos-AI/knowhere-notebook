import type {
  RetrievalQueryParams,
  RetrievalQueryResponse,
} from "@ontos-ai/knowhere-sdk"

export type AgentSurface = "notebook_chat" | "typing_compose" | "typing_quick_ask"

export type AgentTask =
  | "answer"
  | "show_media"
  | "summarize"
  | "compare"
  | "continue_writing"
  | "rewrite"
  | "translate"
  | "correct_previous"
  | "clarify"

export type TargetModality = "text" | "image" | "table" | "page"

export type GroundingPolicy =
  | "must_use_sources"
  | "can_use_context"
  | "no_retrieval"

export type HistoryCarryMode =
  | "none"
  | "referential_only"
  | "full_recent"
  | "repair_previous"

export type IntentFrame = {
  readonly task: AgentTask
  readonly dependsOnPreviousTurn: boolean
  readonly retrievalNeeded: "yes" | "no" | "maybe"
  readonly targetModalities: readonly TargetModality[]
  readonly constraints: {
    readonly desiredCount?: number
    readonly maxCount?: number
    readonly language?: string
    readonly outputStyle?: string
    readonly citationRequired?: boolean
  }
  readonly groundingPolicy: GroundingPolicy
}

export type ContextPolicy = {
  readonly carryHistory: HistoryCarryMode
  readonly reason: string
  readonly activePriorTurnIds: readonly string[]
}

export type AgentTurn = {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly contentPreview: string
  /**
   * Full turn text. Withheld from the default model context (only the preview
   * is shown) to avoid cross-turn pollution, and exposed on demand through the
   * readPriorTurn tool so repair/correction turns can act on real history.
   */
  readonly content?: string
  readonly citationLabels?: readonly string[]
}

export type AgentTurnInput = {
  readonly surface: AgentSurface
  readonly userText: string
  readonly recentTurns: readonly AgentTurn[]
  readonly localContext?: string
  readonly sourceContext?: string
  readonly outputCapabilities: {
    readonly text: boolean
    readonly image: boolean
    readonly table: boolean
    readonly inlineInsertion?: boolean
  }
}

export type HarnessRetrievalRequest = Pick<
  RetrievalQueryParams,
  "query" | "topK" | "signalPaths" | "filterMode" | "threshold"
> & {
  readonly modalities: readonly TargetModality[]
  readonly purpose?: string
}

export type RetrievalCapability = {
  readonly query: (
    input: HarnessRetrievalRequest,
  ) => Promise<RetrievalQueryResponse>
}

export type EvidenceChunk = {
  readonly ref: string
  readonly kind: "result" | "referenced_chunk"
  readonly content: string
  readonly contentPreview: string
  readonly chunkType: string
  readonly score: number | null
  /** Parser-provided chunk identifier when returned by the API. */
  readonly chunkId?: string
  readonly source: {
    readonly documentId?: string | null
    readonly sourceFileName?: string | null
    readonly sectionPath?: string | null
  }
  readonly assetRef?: string
  readonly assetUrl?: string
}

export type EvidenceAsset = {
  readonly ref: string
  readonly chunkRef: string
  readonly type: "image" | "table"
  readonly assetUrl: string
  readonly source: EvidenceChunk["source"]
  readonly label: string
}

export type EvidenceLedgerSnapshot = {
  readonly retrievalCount: number
  readonly chunks: readonly EvidenceChunk[]
  readonly assets: readonly EvidenceAsset[]
  readonly evidenceText: readonly string[]
  readonly stopReasons: readonly string[]
  readonly failureReasons: readonly string[]
  readonly decisionTraces: readonly unknown[]
}

export type OutputCitation = {
  readonly ref: string
  readonly label: string
  readonly source: EvidenceChunk["source"]
}

export type OutputArtifact = {
  readonly type: "image" | "table"
  readonly ref: string
  readonly display: boolean
  readonly reason: string
}

export type DerivedTableArtifact = {
  readonly type: "derived_table"
  readonly ref: string
  readonly title: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly sourceRefs: readonly string[]
  readonly display: boolean
  readonly reason: string
}

export type OutputArtifactView = OutputArtifact | DerivedTableArtifact

export type OutputManifest = {
  readonly text: string
  readonly citations: readonly OutputCitation[]
  readonly artifacts: readonly OutputArtifactView[]
  readonly unresolved: readonly string[]
}

export type HarnessToolCallTrace = {
  readonly tool: string
  readonly ok: boolean
  readonly inputSummary: unknown
  readonly outputSummary: unknown
  readonly startedAt: string
  readonly durationMs: number
}

export type HarnessTrace = {
  readonly intent?: IntentFrame
  readonly contextPolicy?: ContextPolicy
  readonly ledger: EvidenceLedgerSnapshot
  readonly finalized: boolean
  readonly priorTurnReads: readonly string[]
  readonly toolCalls: readonly HarnessToolCallTrace[]
  readonly validationErrors: readonly string[]
  readonly revisionsUsed: number
  /** Total LLM step calls across the agent loop and any revision attempts. */
  readonly llmCallCount?: number
  /** Total input tokens across the agent loop and any revision attempts. */
  readonly inputTokens?: number
  /** Total output tokens across the agent loop and any revision attempts. */
  readonly outputTokens?: number
}

export type HarnessRunResult = {
  readonly manifest: OutputManifest
  readonly trace: HarnessTrace
}
