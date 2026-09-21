import {
  stepCountIs,
  ToolLoopAgent,
  tool,
  type ModelMessage,
  type ToolResultPart,
} from "ai"
import { z } from "zod"

import { logger } from "@/lib/logger"

import { composeAnswerContext } from "./answer-context"
import { createEvidenceLedger } from "./ledger"
import { knowhereToolText } from "./knowhere-text"
import { memoryToolText } from "./memory-text"
import type {
  AgentFeedbackLesson,
  AgentTurn,
  AgentTurnInput,
  ContextPolicy,
  EvidenceLedgerSnapshot,
  HarnessRunResult,
  HarnessToolCallTrace,
  HarnessTrace,
  IntentFrame,
  KnowhereSearchTargetContent,
  KnowhereToolRuntime,
  MemoryCitation,
  MemorySearchKind,
  MemorySearchItem,
  MemoryToolRuntime,
  OutputArtifactView,
  OutputCitation,
  OutputManifest,
  ResolveConnectedAssets,
  WorkspaceProfile,
} from "./types"
import { memorySearchKinds } from "./types"

const defaultMaxSteps = 15
const maxKnowhereSearchAttempts = 1

type ToolLoopAgentSettings = ConstructorParameters<typeof ToolLoopAgent>[0]

export type AgentHarnessModel = ToolLoopAgentSettings["model"]

export type RunAgentHarnessInput = {
  readonly model: AgentHarnessModel
  readonly turn: AgentTurnInput
  readonly knowhereTools: KnowhereToolRuntime
  readonly memoryTools: MemoryToolRuntime
  readonly resolveConnectedAssets?: ResolveConnectedAssets
  readonly maxSteps?: number
  readonly profile?: WorkspaceProfile | null
  readonly agentFeedbackLessons?: readonly AgentFeedbackLesson[]
}

type HarnessToolState = {
  intent?: IntentFrame
  contextPolicy?: ContextPolicy
  finalizedManifest?: OutputManifest
  finalized?: boolean
  answerContextRequested?: boolean
  answerContextMessage?: ModelMessage
  memoryItems?: MemorySearchItem[]
  memorySearchAttempted?: boolean
  knowhereSearchAttemptCount?: number
  priorTurnReads?: string[]
  toolCalls?: HarnessToolCallTrace[]
}

type HarnessTools = ReturnType<typeof createHarnessTools>

type HarnessStepPreparation = {
  messages: ModelMessage[]
  activeTools?: Array<Extract<keyof HarnessTools, string>>
  toolChoice?:
    | "required"
    | {
        type: "tool"
        toolName: Extract<keyof HarnessTools, string>
      }
}

const targetModalitySchema = z.enum(["text", "image", "table"])
const knowhereSearchTargetContentSchema = z.enum([
  "all",
  "text",
  "image",
  "table",
  "text_image",
  "text_table",
])

const knowhereSearchSchema = z.object({
  query: z.string().min(1),
  includeDocumentIds: z.array(z.string().trim().min(1)).optional().describe(
    "Only search these verified document IDs. Omit for unrestricted search; [] searches no documents. Use IDs from previous search results, never filenames or guessed IDs.",
  ),
  excludeDocumentIds: z.array(z.string().trim().min(1)).optional().describe(
    "Exclude these verified document IDs. Exclusions take precedence over includeDocumentIds. If the ID is unknown, describe the document constraint in query instead.",
  ),
  targetContent: knowhereSearchTargetContentSchema.default("all"),
  purpose: z.string().optional(),
  topK: z.number().int().min(1).max(12).optional(),
  signalPaths: z.array(z.string().min(1)).max(8).optional(),
  filterMode: z.enum(["keep", "delete"]).optional(),
  threshold: z.number().min(0).max(1).optional(),
})

const intentFrameSchema = z.object({
  task: z.enum([
    "answer",
    "show_media",
    "summarize",
    "compare",
    "continue_writing",
    "rewrite",
    "translate",
    "correct_previous",
    "clarify",
  ]),
  dependsOnPreviousTurn: z.boolean(),
  retrievalNeeded: z.enum(["yes", "no", "maybe"]),
  targetModalities: z.array(targetModalitySchema).default(["text"]),
  constraints: z
    .object({
      desiredCount: z.number().int().positive().optional(),
      maxCount: z.number().int().positive().optional(),
      language: z.string().optional(),
      outputStyle: z.string().optional(),
      citationRequired: z.boolean().optional(),
    })
    .default({}),
  groundingPolicy: z.enum([
    "must_use_sources",
    "can_use_context",
    "no_retrieval",
  ]),
})

const contextPolicySchema = z.object({
  carryHistory: z.enum([
    "none",
    "referential_only",
    "full_recent",
    "repair_previous",
  ]),
  reason: z.string().min(1),
  activePriorTurnIds: z.array(z.string()).default([]),
})

const citationPickSchema = z.object({
  pick: z.number().int().positive(),
})

const memoryCitationSchema = z.object({
  ref: z.string().min(1),
})

const memorySearchSchema = z.object({
  query: z.string().min(1),
  kinds: z.array(z.enum(memorySearchKinds)).optional(),
})

const selectedOutputArtifactSchema = z.object({
  type: z.enum(["image", "table"]),
  ref: z.string().min(1),
  display: z.boolean(),
  reason: z.string().min(1),
})

const derivedTableArtifactSchema = z.object({
  type: z.literal("derived_table"),
  ref: z.string().min(1),
  title: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1).max(24),
  rows: z.array(z.array(z.string()).min(1).max(24)).max(200),
  sourceRefs: z.array(z.string().min(1)).min(1).max(50),
  display: z.boolean(),
  reason: z.string().min(1),
})

const outputArtifactSchema = z.union([
  selectedOutputArtifactSchema,
  derivedTableArtifactSchema,
])

const finalizeManifestSchema = z.object({
  text: z.string(),
  citations: z.array(citationPickSchema).default([]),
  memoryCitations: z.array(memoryCitationSchema).default([]),
  artifacts: z.array(outputArtifactSchema).default([]),
  unresolved: z.array(z.string()).default([]),
})

export async function runAgentHarness(
  input: RunAgentHarnessInput,
): Promise<HarnessRunResult> {
  const state: HarnessToolState = {
    finalized: false,
    priorTurnReads: [],
    toolCalls: [],
  }
  const ledger = createEvidenceLedger()
  const tools = createHarnessTools({
    state,
    ledger,
    knowhereTools: input.knowhereTools,
    memoryTools: input.memoryTools,
    recentTurns: input.turn.recentTurns,
  })
  const agent = new ToolLoopAgent({
    model: input.model,
    instructions: buildHarnessSystemPrompt(input.turn),
    tools,
    prepareStep: async ({ messages: stepMessages, stepNumber }) => {
      if (
        state.answerContextRequested &&
        !state.answerContextMessage
      ) {
        state.answerContextMessage = await composeAnswerContext({
          ledger: ledger.snapshot(),
          memoryItems: state.memoryItems ?? [],
          memorySearchAttempted: state.memorySearchAttempted === true,
          userText: input.turn.userText,
          profile: input.profile,
          agentFeedbackLessons: input.agentFeedbackLessons,
        })
        await ledger.resolveConnectedAssets(input.resolveConnectedAssets)
      }
      return prepareHarnessStep({
        messages: stepMessages,
        stepNumber,
        intent: state.intent,
        hasKnowhereSearch: (state.knowhereSearchAttemptCount ?? 0) > 0,
        hasReachedKnowhereSearchLimit:
          (state.knowhereSearchAttemptCount ?? 0) >= maxKnowhereSearchAttempts,
        hasMemorySearch: state.memorySearchAttempted === true,
        answerContextMessage: state.answerContextMessage,
      })
    },
    stopWhen: [
      () => state.finalized === true,
      stepCountIs(input.maxSteps ?? defaultMaxSteps),
    ],
  })

  await agent.generate({
    messages: buildHarnessMessages(input.turn),
  })
  if (!state.finalizedManifest) {
    throw new Error("The agent did not finalize an output manifest.")
  }
  const manifest = state.finalizedManifest
  const ledgerSnapshot = ledger.snapshot()
  return {
    manifest,
    memoryItems: state.memoryItems ?? [],
    trace: {
      intent: state.intent,
      contextPolicy: state.contextPolicy,
      ledger: ledgerSnapshot,
      finalized: state.finalized === true,
      priorTurnReads: [...(state.priorTurnReads ?? [])],
      toolCalls: [...(state.toolCalls ?? [])],
      imageHighlights: [],
      validationErrors: [],
      revisionsUsed: 0,
    },
  }
}

const alwaysAvailableTools = [
  "declareIntent",
  "setContextPolicy",
  "readPriorTurn",
] as const

const fluidRetrievalTools = ["memory_search"] as const

const crystalRetrievalTools = ["knowhere_search"] as const

/** Reserved third retrieval slot (cognition). Not registered this round. */
const cognitionRetrievalTools = [] as const

// TODO(memory-architecture): today the agent itself decides, per turn via
// declareIntent, whether to call memory_search / knowhere_search as MCP
// tools. An alternative considered and deferred: always query Memento
// (including future "cognition") on every turn and let Memento decide what,
// if anything, to inject into context, instead of the agent choosing to call
// a tool. Not adopted now — it would replace this tool-invocation control
// flow with a middleware/auto-inject model and needs its own design + test
// rewrite. Revisit if agent misjudgment on retrieval-needed becomes a real
// problem.

export function prepareHarnessStep(input: {
  readonly stepNumber: number
  readonly messages: readonly ModelMessage[]
  readonly hasKnowhereSearch?: boolean
  readonly hasReachedKnowhereSearchLimit?: boolean
  readonly hasMemorySearch?: boolean
  readonly answerContextMessage?: ModelMessage
  readonly intent?: IntentFrame
}): HarnessStepPreparation {
  const messages = sanitizeHarnessModelMessagesForStep(input.messages)

  if (input.answerContextMessage) {
    return {
      messages: [input.answerContextMessage],
      activeTools: ["finalize"],
      toolChoice: {
        type: "tool",
        toolName: "finalize",
      },
    }
  }

  if (input.hasReachedKnowhereSearchLimit === true) {
    return {
      messages,
      activeTools: ["prepareAnswer"],
      toolChoice: {
        type: "tool",
        toolName: "prepareAnswer",
      },
    }
  }

  return {
    messages,
    activeTools: selectHarnessActiveTools({
      intent: input.intent,
      hasKnowhereSearch: input.hasKnowhereSearch === true,
      hasMemorySearch: input.hasMemorySearch === true,
    }),
    // Tool calls are required so the retrieval phase cannot end with bare
    // text and skip the composed answer context or finalize validation.
    toolChoice: "required",
  }
}

function selectHarnessActiveTools(input: {
  readonly intent?: IntentFrame
  readonly hasKnowhereSearch: boolean
  readonly hasMemorySearch: boolean
}): Array<Extract<keyof HarnessTools, string>> {
  const tools: Array<Extract<keyof HarnessTools, string>> = [
    ...alwaysAvailableTools,
  ]
  if (allowsAnswerPreparation(input)) {
    tools.push("prepareAnswer")
  }
  if (!allowsRetrieval(input.intent)) {
    return tools
  }

  // memory_search and knowhere_search are peers: both open together once
  // retrieval is allowed. Each may run once per turn.
  if (!input.hasMemorySearch) tools.push(...fluidRetrievalTools)
  if (
    input.intent?.groundingPolicy === "must_use_sources" &&
    !input.hasKnowhereSearch
  ) {
    tools.push(...crystalRetrievalTools)
  }
  tools.push(...cognitionRetrievalTools)
  return tools
}

function allowsRetrieval(intent?: IntentFrame): boolean {
  if (!intent) return false
  return (
    intent.groundingPolicy !== "no_retrieval" && intent.retrievalNeeded !== "no"
  )
}

function allowsAnswerPreparation(input: {
  readonly intent?: IntentFrame
  readonly hasKnowhereSearch: boolean
}): boolean {
  if (!input.intent) return false
  if (
    input.intent.groundingPolicy === "must_use_sources" &&
    allowsRetrieval(input.intent) &&
    !input.hasKnowhereSearch
  ) {
    return false
  }
  return true
}

export function sanitizeHarnessModelMessagesForStep(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  return messages.map(sanitizeHarnessModelMessageForStep)
}

function sanitizeHarnessModelMessageForStep(
  message: ModelMessage,
): ModelMessage {
  if (message.role === "tool") {
    return {
      ...message,
      providerOptions: undefined,
      content: message.content.map(sanitizeToolMessageContentPart),
    }
  }

  if (message.role === "assistant" && Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map(sanitizeAssistantMessageContentPart),
    }
  }

  return message
}

function sanitizeToolMessageContentPart(
  part: ModelMessageForRole<"tool">["content"][number],
): ModelMessageForRole<"tool">["content"][number] {
  if (part.type !== "tool-result") return part

  return removeToolResultPartProviderOptions(part)
}

function sanitizeAssistantMessageContentPart(
  part: Exclude<ModelMessageForRole<"assistant">["content"], string>[number],
): Exclude<ModelMessageForRole<"assistant">["content"], string>[number] {
  if (part.type !== "tool-result") return part

  return removeToolResultPartProviderOptions(part)
}

function removeToolResultPartProviderOptions(
  part: ToolResultPart,
): ToolResultPart {
  const sanitizedPart = { ...part }
  delete sanitizedPart.providerOptions
  return sanitizedPart
}

type ModelMessageForRole<TRole extends ModelMessage["role"]> = Extract<
  ModelMessage,
  { readonly role: TRole }
>

export function createHarnessTools(input: {
  readonly state: HarnessToolState
  readonly ledger: ReturnType<typeof createEvidenceLedger>
  readonly knowhereTools: KnowhereToolRuntime
  readonly memoryTools: MemoryToolRuntime
  readonly recentTurns: readonly AgentTurn[]
}) {
  return {
    declareIntent: tool({
      description:
        "Declare the user's intent when it helps plan the response. This is working memory, not a final answer.",
      inputSchema: intentFrameSchema,
      execute: async (intent): Promise<IntentFrame> =>
        traceToolCall(input.state, {
          toolName: "declareIntent",
          inputSummary: summarizeIntent(intent),
          execute: async () => {
            input.state.intent = intent
            return intent
          },
          summarizeOutput: summarizeIntent,
        }),
    }),

    setContextPolicy: tool({
      description:
        "Decide whether prior turns should influence this turn. Use none for unrelated follow-ups.",
      inputSchema: contextPolicySchema,
      execute: async (policy): Promise<ContextPolicy> =>
        traceToolCall(input.state, {
          toolName: "setContextPolicy",
          inputSummary: summarizeContextPolicy(policy),
          execute: async () => {
            input.state.contextPolicy = policy
            return policy
          },
          summarizeOutput: summarizeContextPolicy,
        }),
    }),

    memory_search: tool({
      description:
        "Search distilled fluid memory for this workspace. Returns tagged text with memory refs such as mem:1. It can run alongside Knowhere document search when both are useful.",
      inputSchema: memorySearchSchema,
      execute: async (request) =>
        traceToolCall(input.state, {
          toolName: "memory_search",
          inputSummary: summarizeMemorySearchRequest(request),
          execute: async () => {
            return await executeMemorySearch({
              state: input.state,
              memoryTools: input.memoryTools,
              request,
            })
          },
          summarizeOutput: summarizeMemoryTextOutput,
        }),
    }),

    knowhere_search: tool({
      description:
        "Search Knowhere for relevant Notebook evidence. Returns tagged text with pick numbers for finalize citations, evidence refs such as r1:result:1, and connected image/table asset paths when present. Call once per turn; do not change the query and search again.",
      inputSchema: knowhereSearchSchema,
      execute: async (request) =>
        traceToolCall(input.state, {
          toolName: "knowhere_search",
          inputSummary: summarizeKnowhereSearchRequest(request),
          execute: async () =>
            executeKnowhereSearch({
              state: input.state,
              ledger: input.ledger,
              knowhereTools: input.knowhereTools,
              request,
            }),
          summarizeOutput: summarizeKnowhereTextOutput,
        }),
    }),

    readPriorTurn: tool({
      description:
        "Read the full text and citation labels of a specific prior turn by id " +
        "(ids come from the recent turn index). Use this only when the current " +
        "request depends on, references, or corrects a previous turn.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      execute: async ({ id }) =>
        traceToolCall(input.state, {
          toolName: "readPriorTurn",
          inputSummary: { id },
          execute: async () => {
            if (!input.state.contextPolicy) {
              return {
                found: false as const,
                id,
                message: "setContextPolicy must be called before readPriorTurn.",
              }
            }
            if (input.state.contextPolicy.carryHistory === "none") {
              return {
                found: false as const,
                id,
                message:
                  "readPriorTurn is not allowed when carryHistory is none.",
              }
            }
            if (!input.state.contextPolicy.activePriorTurnIds.includes(id)) {
              return {
                found: false as const,
                id,
                message:
                  "readPriorTurn id must be listed in activePriorTurnIds.",
              }
            }
            const priorTurn = input.recentTurns.find((turn) => turn.id === id)
            if (!priorTurn) {
              return {
                found: false as const,
                id,
                message: "No prior turn with that id is available.",
              }
            }
            const priorTurnReads = input.state.priorTurnReads ?? []
            if (!priorTurnReads.includes(id)) priorTurnReads.push(id)
            input.state.priorTurnReads = priorTurnReads
            return {
              found: true as const,
              id,
              role: priorTurn.role,
              content: priorTurn.content ?? priorTurn.contentPreview,
              citationLabels: priorTurn.citationLabels ?? [],
            }
          },
          summarizeOutput: summarizeReadPriorTurnOutput,
        }),
    }),

    prepareAnswer: tool({
      description:
        "Finish retrieval and assemble Knowledge Base search results, all fluid memory results, and the user's original question into one multimodal message for the answer step.",
      inputSchema: z.object({}),
      execute: async () =>
        traceToolCall(input.state, {
          toolName: "prepareAnswer",
          inputSummary: {},
          execute: async () => {
            input.state.answerContextRequested = true
            return { ok: true as const }
          },
          summarizeOutput: (output) => output,
        }),
    }),

    finalize: tool({
      description:
        "Finalize the user-facing output manifest. This is the only final answer " +
        "contract. Artifacts listed here with display=true are the exact set of " +
        "images/tables shown to the user. citations is the list of evidence picks " +
        "you used; each pick is the pick number on a Knowhere search chunk. " +
        "Notebook writes citation refs from the evidence ledger. " +
        "Use memoryCitations for fluid memory and copy only the mem:N ref " +
        "from the assembled Fluid Memory entries.",
      inputSchema: finalizeManifestSchema,
      execute: async (manifest) =>
        traceToolCall(input.state, {
          toolName: "finalize",
          inputSummary: summarizeManifest(manifest),
          execute: async () => {
            const resolvedCitations = resolveCitationPicks({
              citations: manifest.citations,
              ledger: input.ledger,
            })
            if (!resolvedCitations.ok) {
              return {
                ok: false as const,
                message: buildFinalizeRequiresPicksMessage({
                  unknownPicks: resolvedCitations.unknownPicks,
                  ledger: input.ledger.snapshot(),
                }),
                unknownPicks: resolvedCitations.unknownPicks,
              }
            }

            const resolvedMemoryCitations = resolveMemoryCitations({
              citations: manifest.memoryCitations,
              memoryItems: input.state.memoryItems ?? [],
            })
            if (!resolvedMemoryCitations.ok) {
              return {
                ok: false as const,
                message:
                  "memoryCitations must use mem:N refs from this turn's Fluid Memory results.",
                invalidMemoryCitations: resolvedMemoryCitations.invalid,
              }
            }

            const outputManifest: OutputManifest = {
              text: manifest.text,
              citations: resolvedCitations.citations,
              memoryCitations: resolvedMemoryCitations.citations,
              artifacts: manifest.artifacts,
              unresolved: manifest.unresolved,
            }

            input.state.finalizedManifest = outputManifest
            input.state.finalized = true
            return { ok: true as const, ...outputManifest }
          },
          summarizeOutput: summarizeFinalizeOutput,
        }),
    }),
  } as const
}

function resolveCitationPicks(input: {
  readonly citations: readonly { pick: number }[]
  readonly ledger: ReturnType<typeof createEvidenceLedger>
}):
  | { ok: true; citations: OutputCitation[] }
  | { ok: false; unknownPicks: number[] } {
  const chunks = input.ledger.snapshot().chunks
  const unknownPicks: number[] = []
  const citations: OutputCitation[] = []

  for (const citation of input.citations) {
    const chunk = Number.isInteger(citation.pick)
      ? chunks[citation.pick - 1]
      : undefined
    if (!chunk) {
      if (!unknownPicks.includes(citation.pick)) {
        unknownPicks.push(citation.pick)
      }
      continue
    }
    citations.push({ ref: chunk.ref })
  }

  if (unknownPicks.length > 0) {
    return { ok: false, unknownPicks }
  }
  return { ok: true, citations }
}

function resolveMemoryCitations(input: {
  readonly citations: readonly { ref: string }[]
  readonly memoryItems: readonly MemorySearchItem[]
}):
  | { ok: true; citations: MemoryCitation[] }
  | { ok: false; invalid: readonly { ref: string }[] } {
  const byRef = new Map(input.memoryItems.map((item) => [item.ref, item]))
  const citations: MemoryCitation[] = []
  const invalid: { ref: string }[] = []
  for (const citation of input.citations) {
    const item = byRef.get(citation.ref)
    if (!item) {
      invalid.push({ ref: citation.ref })
      continue
    }
    citations.push({
      ref: item.ref,
      itemId: item.itemId,
      kind: item.kind,
    })
  }
  if (invalid.length > 0) return { ok: false, invalid }
  return { ok: true, citations }
}

function buildFinalizeRequiresPicksMessage(input: {
  readonly unknownPicks: readonly number[]
  readonly ledger: EvidenceLedgerSnapshot
}): string {
  const availableCount = input.ledger.chunks.length
  return [
    "Citations must use pick numbers from Knowhere search chunks.",
    `Unknown citation picks: ${input.unknownPicks.join(" ")}.`,
    availableCount > 0
      ? `Available picks: 1-${availableCount}.`
      : "No evidence picks are available; list the gap in unresolved and omit citations.",
    "Call finalize again using only available picks.",
  ].join(" ")
}


type KnowhereToolOperation = "search"

type MemorySearchToolRequest = z.infer<typeof memorySearchSchema>
type KnowhereSearchToolRequest = z.infer<typeof knowhereSearchSchema>

async function executeMemorySearch(input: {
  readonly state: HarnessToolState
  readonly memoryTools: MemoryToolRuntime
  readonly request: MemorySearchToolRequest
}): Promise<string> {
  if (input.state.memorySearchAttempted) {
    return memoryToolText.formatError({
      operation: "search",
      message: "Fluid memory search already ran for this turn.",
    })
  }
  input.state.memorySearchAttempted = true

  try {
    const response = await input.memoryTools.search({
      query: input.request.query,
      kinds: input.request.kinds,
    })
    accumulateMemoryItems(input.state, response.items)
    return memoryToolText.formatSearch(response)
  } catch (error) {
    // TODO: Memento 未部署时搜索会失败，先只记警告；部署并对上地址后应能搜到。
    logger.warn("chat: failed to search memory", {
      query: input.request.query,
      error: formatUnknownError(error),
    })
    return memoryToolText.formatWarning({
      operation: "search",
      message: formatUnknownError(error),
    })
  }
}

function accumulateMemoryItems(
  state: HarnessToolState,
  items: readonly MemorySearchItem[],
): void {
  const accumulated = state.memoryItems ?? []
  const itemIds = new Set(accumulated.map((item) => item.itemId))
  for (const item of items) {
    if (itemIds.has(item.itemId)) continue
    accumulated.push(item)
    itemIds.add(item.itemId)
  }
  state.memoryItems = accumulated
}

async function executeKnowhereSearch(input: {
  readonly state: HarnessToolState
  readonly ledger: ReturnType<typeof createEvidenceLedger>
  readonly knowhereTools: KnowhereToolRuntime
  readonly request: KnowhereSearchToolRequest
}): Promise<string> {
  return executeKnowhereTextTool({
    operation: "search",
    execute: async () => {
      const attemptCount = input.state.knowhereSearchAttemptCount ?? 0
      if (attemptCount >= maxKnowhereSearchAttempts) {
        return knowhereToolText.formatError({
          operation: "search",
          message:
            "Knowhere search already ran for this turn. Call prepareAnswer now.",
        })
      }
      input.state.knowhereSearchAttemptCount = attemptCount + 1
      const beforeSnapshot = input.ledger.snapshot()
      const response = await input.knowhereTools.search({
        query: input.request.query,
        ...(input.request.includeDocumentIds !== undefined
          ? { includeDocumentIds: input.request.includeDocumentIds }
          : {}),
        ...(input.request.excludeDocumentIds !== undefined
          ? { excludeDocumentIds: input.request.excludeDocumentIds }
          : {}),
        targetContent: input.request.targetContent,
        purpose: input.request.purpose,
        topK: input.request.topK,
        signalPaths: input.request.signalPaths,
        filterMode: input.request.filterMode,
        threshold: input.request.threshold,
      })
      const snapshot = input.ledger.addRetrievalResponse(response)
      return knowhereToolText.formatSearch({
        response,
        retrievalCount: snapshot.retrievalCount,
        chunkPickStart: beforeSnapshot.chunks.length,
        chunks: snapshot.chunks.slice(beforeSnapshot.chunks.length),
        assets: snapshot.assets.slice(beforeSnapshot.assets.length),
      })
    },
  })
}

async function executeKnowhereTextTool(input: {
  readonly operation: KnowhereToolOperation
  readonly execute: () => Promise<string>
}): Promise<string> {
  try {
    return await input.execute()
  } catch (error) {
    return knowhereToolText.formatError({
      operation: input.operation,
      message: formatUnknownError(error),
    })
  }
}

async function traceToolCall<T>(input: {
  readonly toolCalls?: HarnessToolCallTrace[]
}, call: {
  readonly toolName: string
  readonly inputSummary: unknown
  readonly execute: () => Promise<T>
  readonly summarizeOutput: (output: T) => unknown
}): Promise<T> {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  try {
    const output = await call.execute()
    recordToolCall(input, {
      tool: call.toolName,
      ok: getToolTraceOk(output),
      inputSummary: call.inputSummary,
      outputSummary: call.summarizeOutput(output),
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
    })
    return output
  } catch (error) {
    recordToolCall(input, {
      tool: call.toolName,
      ok: false,
      inputSummary: call.inputSummary,
      outputSummary: {
        error: error instanceof Error ? error.message : String(error),
      },
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
    })
    throw error
  }
}

function recordToolCall(
  state: { toolCalls?: HarnessToolCallTrace[] },
  trace: HarnessToolCallTrace,
): void {
  const toolCalls = state.toolCalls ?? []
  toolCalls.push(trace)
  state.toolCalls = toolCalls
}

function getToolTraceOk(output: unknown): boolean {
  if (typeof output === "string") return !output.includes('status="error"')
  if (!isRecord(output)) return true
  if (typeof output.ok === "boolean") return output.ok
  if (typeof output.found === "boolean") return output.found
  return true
}

function summarizeIntent(intent: IntentFrame): unknown {
  return {
    task: intent.task,
    dependsOnPreviousTurn: intent.dependsOnPreviousTurn,
    retrievalNeeded: intent.retrievalNeeded,
    targetModalities: intent.targetModalities,
    constraints: intent.constraints,
    groundingPolicy: intent.groundingPolicy,
  }
}

function summarizeContextPolicy(policy: ContextPolicy): unknown {
  return {
    carryHistory: policy.carryHistory,
    activePriorTurnIds: policy.activePriorTurnIds,
  }
}

function summarizeMemorySearchRequest(request: {
  readonly query: string
  readonly kinds?: readonly MemorySearchKind[]
}): unknown {
  return {
    query: request.query,
    kinds: request.kinds,
  }
}

function summarizeMemoryTextOutput(output: unknown): unknown {
  if (typeof output !== "string") return output
  return {
    ok: !output.includes('status="error"'),
    textLength: output.length,
    itemCount: countOccurrences(output, "<item "),
  }
}

function summarizeKnowhereSearchRequest(request: {
  readonly query: string
  readonly targetContent?: KnowhereSearchTargetContent
  readonly purpose?: string
  readonly topK?: number
  readonly signalPaths?: readonly string[]
  readonly filterMode?: string
  readonly threshold?: number
}): unknown {
  return {
    query: request.query,
    targetContent: request.targetContent ?? "all",
    purpose: request.purpose,
    topK: request.topK,
    signalPathCount: request.signalPaths?.length ?? 0,
    filterMode: request.filterMode,
    threshold: request.threshold,
  }
}

function summarizeKnowhereTextOutput(output: unknown): unknown {
  if (typeof output !== "string") return output
  return {
    ok: !output.includes('status="error"'),
    textLength: output.length,
    chunkCount: countOccurrences(output, "<chunk "),
    assetCount: countOccurrences(output, "<asset "),
    truncated: output.includes('truncated="true"'),
  }
}

function countOccurrences(value: string, pattern: string): number {
  let count = 0
  let offset = 0
  for (;;) {
    const index = value.indexOf(pattern, offset)
    if (index === -1) return count
    count += 1
    offset = index + pattern.length
  }
}

function summarizeReadPriorTurnOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  return {
    found: output.found,
    id: output.id,
    role: output.role,
    citationLabelCount: Array.isArray(output.citationLabels)
      ? output.citationLabels.length
      : 0,
    message: output.message,
  }
}

function summarizeManifest(manifest: {
  readonly text: string
  readonly citations: readonly unknown[]
  readonly memoryCitations: readonly unknown[]
  readonly artifacts: readonly OutputArtifactView[]
  readonly unresolved: readonly string[]
}): unknown {
  return {
    textLength: manifest.text.length,
    citationCount: manifest.citations.length,
    memoryCitationCount: manifest.memoryCitations.length,
    artifactCount: manifest.artifacts.length,
    displayedArtifactCount: manifest.artifacts.filter((artifact) => artifact.display)
      .length,
    derivedTableCount: manifest.artifacts.filter(
      (artifact) => artifact.type === "derived_table",
    ).length,
    unresolvedCount: manifest.unresolved.length,
  }
}

function summarizeFinalizeOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  return {
    ok: output.ok,
    textLength: typeof output.text === "string" ? output.text.length : 0,
    citationCount: Array.isArray(output.citations) ? output.citations.length : 0,
    memoryCitationCount: Array.isArray(output.memoryCitations)
      ? output.memoryCitations.length
      : 0,
    artifactCount: Array.isArray(output.artifacts) ? output.artifacts.length : 0,
    unresolvedCount: Array.isArray(output.unresolved)
      ? output.unresolved.length
      : 0,
    message: output.message,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function buildHarnessSystemPrompt(turn: AgentTurnInput): string {
  return [
    "You are the outer Knowhere Agent Harness.",
    "KNOWHERE is only an evidence provider. Do not infer or control its internal navigation algorithm.",
    "Your job is to understand intent, decide context use, optionally retrieve evidence, select evidence/artifacts, create source-backed derived tables when useful, and finalize an output manifest.",
    "",
    "Recommended workflow:",
    "1. Call declareIntent when it helps you plan the response. Capture constraints like a requested image/table count in constraints.desiredCount.",
    "2. Call setContextPolicy when prior turns may influence this turn.",
    "3. When the policy needs prior-turn detail (references or corrections), call readPriorTurn for the relevant ids.",
    "4. Call memory_search for relevant fluid memory and knowhere_search when groundingPolicy requires source documents. When both are useful, call them together in the same step. Call knowhere_search once; do not change the query and search again. Knowhere's own retrieval agent already navigates the corpus internally.",
    "5. After a search, call prepareAnswer. All Knowhere search results, all fluid memory results, and the user's original question will be assembled into one multimodal message.",
    "6. Read that assembled message once and call finalize with the answer, citations, artifacts, and unresolved issues.",
    "",
    "Retrieval rules:",
    "- memory_search and knowhere_search are parallel retrieval sources. When both apply, call them together rather than making one wait for the other.",
    "- Call memory_search once per turn. An empty result remains empty; do not retry it.",
    "- Call knowhere_search once per turn when groundingPolicy requires citing source documents. An empty result remains empty; do not change the query and search again.",
    "- Image/table asset paths in retrieved chunks are debug references. Composed evidence is already assembled for the answer step. Do not search again because those assets have not been shown yet.",
    "- Do not treat every question as a document-retrieval task.",
    "- For document-scoped searches, use includeDocumentIds/excludeDocumentIds only with verified IDs from prior search results. If IDs are unknown, preserve the document requirement in query so Knowhere can locate it. Never invent IDs or substitute filenames. Exclusions win; an empty includeDocumentIds means no documents.",
    "",
    "Context rules:",
    "- If the current user request is unrelated to prior turns, set carryHistory to none and do not reuse prior topics.",
    "- If the user corrects a previous answer, set carryHistory to repair_previous, read the relevant prior turn, then re-retrieve and re-answer using the correction.",
    "- If the user uses references like this document, that image, or the previous answer, choose referential_only or full_recent and read the prior turn you depend on.",
    "",
    "Output rules:",
    "- Final output is the OutputManifest passed to finalize, not freeform tool JSON or trailing text.",
    "- artifacts with display=true are the exact images/tables shown. Never display every candidate; honor constraints.desiredCount / maxCount.",
    "- Use type=derived_table only for tables you create from evidence; every derived_table.sourceRefs entry must reference evidence in the ledger.",
    "- citations is a list of { pick }. pick is the 1-based number on the search chunk you are using. Notebook writes the citation list from those picks. Do not pass documentId or evidence refs as citations.",
    "- Place [[cite:n]] immediately after the supported claim. n is the 1-based index into the citations array passed to finalize.",
    "- Write one marker per index: [[cite:1]] [[cite:3]] [[cite:5]]. Never group indices as [[cite:1, 3, 5]].",
    "- Do not write title/pN, [1], Markdown footnotes, or [Source N: ...] in the answer text. Notebook renders chips from [[cite:n]] and citation metadata.",
    "- Repeat [[cite:n]] when another claim uses the same page. Do not collapse same-page citations to one row.",
    "- If you have no supporting evidence pick, omit citations and list the gap in unresolved.",
    "- Images in search evidence are embedded directly in the assembled user message. Read them there; do not call a separate image-inspection step.",
    "- If evidence is insufficient, list it in unresolved instead of fabricating facts.",
    `Surface: ${turn.surface}`,
    `Output capabilities: ${JSON.stringify(turn.outputCapabilities)}`,
  ]
    .filter((line): line is string => line.length > 0)
    .join("\n")
}

export function buildHarnessMessages(turn: AgentTurnInput): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        `Current user request:\n${turn.userText}`,
        turn.localContext ? `Local context:\n${turn.localContext}` : "",
        formatRecentTurnIndex(turn),
      ]
        .filter((part) => part.length > 0)
        .join("\n\n"),
    },
  ]
}

function formatRecentTurnIndex(turn: AgentTurnInput): string {
  if (turn.recentTurns.length === 0) return "Recent turn index: none"

  const lines = turn.recentTurns.map((recentTurn) => {
    const citationSuffix = recentTurn.citationLabels?.length
      ? ` citations=${recentTurn.citationLabels.join("; ")}`
      : ""
    return `- id=${recentTurn.id} role=${recentTurn.role}${citationSuffix} preview=${JSON.stringify(recentTurn.contentPreview)}`
  })
  return ["Recent turn index:", ...lines].join("\n")
}
export type { HarnessTrace }
