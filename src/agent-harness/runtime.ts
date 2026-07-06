import {
  hasToolCall,
  stepCountIs,
  ToolLoopAgent,
  tool,
  type ModelMessage,
  type ToolResultPart,
} from "ai"
import { z } from "zod"

import { createEvidenceLedger } from "./ledger"
import type {
  AgentTurn,
  AgentTurnInput,
  ContextPolicy,
  HarnessRunResult,
  HarnessToolCallTrace,
  HarnessTrace,
  ImageInspectionAsset,
  ImageInspectionResponse,
  InspectImages,
  IntentFrame,
  OutputManifest,
  RetrievalCapability,
  TargetModality,
} from "./types"
import { validateOutputManifest } from "./validator"

const defaultMaxSteps = 14
const defaultMaxRevisions = 1
const imageInspectionReminderStepNumber = 12
const forcedFinalizationStepNumber = 13
const imageInspectionRefLimit = 6

type ToolLoopAgentSettings = ConstructorParameters<typeof ToolLoopAgent>[0]

export type AgentHarnessModel = ToolLoopAgentSettings["model"]

export type RunAgentHarnessInput = {
  readonly model: AgentHarnessModel
  readonly turn: AgentTurnInput
  readonly retrieval: RetrievalCapability
  readonly inspectImages?: InspectImages
  readonly maxSteps?: number
  /**
   * How many times the agent may revise after a failed validation pass before
   * the harness gives up and returns the last manifest with recorded errors.
   */
  readonly maxRevisions?: number
}

type HarnessToolState = {
  intent?: IntentFrame
  contextPolicy?: ContextPolicy
  finalizedManifest?: OutputManifest
  finalized?: boolean
  priorTurnReads?: string[]
  inspectedImageRefs?: string[]
  toolCalls?: HarnessToolCallTrace[]
}

type HarnessTools = ReturnType<typeof createHarnessTools>

type HarnessStepPreparation = {
  messages: ModelMessage[]
  activeTools?: Array<Extract<keyof HarnessTools, string>>
  toolChoice?: {
    type: "tool"
    toolName: Extract<keyof HarnessTools, string>
  }
}

const targetModalitySchema = z.enum(["text", "image", "table"])

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

const outputCitationSchema = z.object({
  ref: z.string().min(1),
  label: z.string().min(1),
  source: z.object({
    documentId: z.string().nullable().optional(),
    sourceFileName: z.string().nullable().optional(),
    sectionPath: z.string().nullable().optional(),
  }),
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

const outputManifestSchema = z.object({
  text: z.string(),
  citations: z.array(outputCitationSchema).default([]),
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
    retrieval: input.retrieval,
    inspectImages: input.inspectImages,
    recentTurns: input.turn.recentTurns,
  })
  const agent = new ToolLoopAgent({
    model: input.model,
    instructions: buildHarnessSystemPrompt(input.turn),
    tools,
    prepareStep: ({ messages: stepMessages, stepNumber }) =>
      prepareHarnessStep({
        messages: stepMessages,
        stepNumber,
        hasUninspectedImageAssets:
          input.inspectImages !== undefined &&
          hasUninspectedImageAssets({ state, ledger }),
      }),
    stopWhen: [
      hasToolCall("finalize"),
      stepCountIs(input.maxSteps ?? defaultMaxSteps),
    ],
  })

  const maxRevisions = input.maxRevisions ?? defaultMaxRevisions
  let messages = buildHarnessMessages(input.turn)
  let manifest = buildFallbackManifest("")
  let validationErrors: readonly string[] = []
  let revisionsUsed = 0

  for (let attempt = 0; ; attempt += 1) {
    const response = await agent.generate({ messages })
    manifest =
      state.finalizedManifest ?? buildFallbackManifest(response.text.trim())

    const validation = validateOutputManifest({
      manifest,
      intent: state.intent,
      contextPolicy: state.contextPolicy,
      finalized: state.finalized === true,
      ledger: ledger.snapshot(),
      toolCalls: state.toolCalls,
      surface: input.turn.surface,
    })
    validationErrors = validation.errors

    if (validation.ok || attempt >= maxRevisions) break

    // Self-correction (reflexion): continue the same conversation with
    // structured validator feedback and require a fresh finalize so the agent
    // can repair its own contract violations instead of shipping them.
    revisionsUsed += 1
    state.finalizedManifest = undefined
    state.finalized = false
    messages = [
      ...messages,
      ...(response.response.messages as ModelMessage[]),
      {
        role: "user",
        content: buildRevisionFeedback(validation.errors),
      },
    ]
  }

  const ledgerSnapshot = ledger.snapshot()
  return {
    manifest,
    trace: {
      intent: state.intent,
      contextPolicy: state.contextPolicy,
      ledger: ledgerSnapshot,
      finalized: state.finalized === true,
      priorTurnReads: [...(state.priorTurnReads ?? [])],
      toolCalls: [...(state.toolCalls ?? [])],
      validationErrors,
      revisionsUsed,
    },
  }
}

export function prepareHarnessStep(input: {
  readonly stepNumber: number
  readonly messages: readonly ModelMessage[]
  readonly hasUninspectedImageAssets?: boolean
}): HarnessStepPreparation {
  const messages = sanitizeHarnessModelMessagesForStep(input.messages)

  if (
    input.stepNumber === imageInspectionReminderStepNumber &&
    input.hasUninspectedImageAssets === true
  ) {
    return {
      messages: [
        ...messages,
        {
          role: "user",
          content: buildImageInspectionReminderFeedback(),
        },
      ],
      activeTools: ["inspectImage"],
      toolChoice: {
        type: "tool",
        toolName: "inspectImage",
      },
    }
  }

  if (input.stepNumber < forcedFinalizationStepNumber) {
    return { messages }
  }

  return {
    messages: [
      ...messages,
      {
        role: "user",
        content: buildForcedFinalizationFeedback(),
      },
    ],
    activeTools: ["finalize"],
    toolChoice: {
      type: "tool",
      toolName: "finalize",
    },
  }
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

function buildRevisionFeedback(errors: readonly string[]): string {
  return [
    "Your finalize output did not satisfy the output contract:",
    ...errors.map((error) => `- ${error}`),
    "",
    "Fix every issue and call finalize again with a corrected manifest.",
    "You must call finalize; freeform assistant text is not a valid final",
    "answer contract.",
    "Do not exceed the user's requested artifact count, only cite or display",
    "evidence refs that exist in the evidence ledger, and do not fabricate",
    "facts when evidence is missing.",
  ].join("\n")
}

function buildForcedFinalizationFeedback(): string {
  return [
    "The retrieval step budget has been reached.",
    "Do not search again or call any evidence-reading tools.",
    "Use only the evidence and tool results already available in this turn.",
    "Call finalize now with the best supported answer.",
    "If the existing evidence is insufficient, explain the gap in unresolved",
    "instead of making unsupported claims.",
  ].join("\n")
}

function buildImageInspectionReminderFeedback(): string {
  return [
    "The retrieval step budget is nearly reached and retrieved image assets are available.",
    "If the exact answer depends on OCR, page-image text, visual details, or image verification, call inspectImage now with the most relevant retrieved image asset refs.",
    "If image inspection is not needed for this answer, call finalize using the evidence already available.",
    "Do not search again.",
  ].join("\n")
}

function hasUninspectedImageAssets(input: {
  readonly state: HarnessToolState
  readonly ledger: ReturnType<typeof createEvidenceLedger>
}): boolean {
  const inspectedRefs = new Set(input.state.inspectedImageRefs ?? [])
  return input.ledger
    .snapshot()
    .assets.some(
      (asset) => asset.type === "image" && !inspectedRefs.has(asset.ref),
    )
}

export function createHarnessTools(input: {
  readonly state: HarnessToolState
  readonly ledger: ReturnType<typeof createEvidenceLedger>
  readonly retrieval: RetrievalCapability
  readonly inspectImages?: InspectImages
  readonly recentTurns: readonly AgentTurn[]
}) {
  return {
    declareIntent: tool({
      description:
        "Declare the user's intent before any other action. This is working memory, not a final answer.",
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

    retrieve: tool({
      description:
        "Ask KNOWHERE for evidence context. KNOWHERE handles internal navigation; this tool only submits a concise query and records returned evidence.",
      inputSchema: z.object({
        query: z.string().min(1),
        modalities: z.array(targetModalitySchema).default(["text"]),
        purpose: z.string().optional(),
        topK: z.number().int().min(1).max(12).optional(),
        signalPaths: z.array(z.string().min(1)).max(8).optional(),
        filterMode: z.enum(["keep", "delete"]).optional(),
        threshold: z.number().min(0).max(1).optional(),
      }),
      execute: async (request) =>
        traceToolCall(input.state, {
          toolName: "retrieve",
          inputSummary: summarizeRetrievalRequest(request),
          execute: async () => {
            if (!input.state.intent) {
              return {
                ok: false,
                message: "declareIntent must be called before retrieve.",
              }
            }
            if (!input.state.contextPolicy) {
              return {
                ok: false,
                message: "setContextPolicy must be called before retrieve.",
              }
            }

            const beforeSnapshot = input.ledger.snapshot()
            const response = await input.retrieval.query({
              query: request.query,
              modalities: request.modalities as TargetModality[],
              purpose: request.purpose,
              topK: request.topK,
              signalPaths: request.signalPaths,
              filterMode: request.filterMode,
              threshold: request.threshold,
            })
            const snapshot = input.ledger.addRetrievalResponse(response)
            const currentChunks = snapshot.chunks.slice(
              beforeSnapshot.chunks.length,
            )
            const currentAssets = snapshot.assets.slice(
              beforeSnapshot.assets.length,
            )
            return {
              ok: true,
              retrievalCount: snapshot.retrievalCount,
              evidenceText: response.evidenceText ?? "",
              stopReason: response.stopReason ?? null,
              failureReason: response.failureReason ?? null,
              chunks: currentChunks.map((chunk) => ({
                ref: chunk.ref,
                kind: chunk.kind,
                type: chunk.chunkType,
                preview: chunk.contentPreview,
                source: chunk.source,
                assetRef: chunk.assetRef,
              })),
              assets: currentAssets.map((asset) => ({
                ref: asset.ref,
                type: asset.type,
                label: asset.label,
                source: asset.source,
              })),
            }
          },
          summarizeOutput: summarizeRetrieveOutput,
        }),
    }),

    inspectImage: tool({
      description:
        "Inspect retrieved image asset refs visually for OCR, visual details, comparisons, or verification. Use only after retrieve has returned image assets.",
      inputSchema: z.object({
        refs: z.array(z.string().min(1)).min(1).max(imageInspectionRefLimit),
        question: z.string().min(1),
      }),
      execute: async (request) =>
        traceToolCall(input.state, {
          toolName: "inspectImage",
          inputSummary: summarizeInspectImageRequest(request),
          execute: async () =>
            inspectRetrievedImages({
              state: input.state,
              ledger: input.ledger,
              inspectImages: input.inspectImages,
              refs: request.refs,
              question: request.question,
            }),
          summarizeOutput: summarizeInspectImageOutput,
        }),
    }),

    readEvidence: tool({
      description:
        "Read more text from an evidence chunk already returned by KNOWHERE.",
      inputSchema: z.object({
        ref: z.string().min(1),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(8_000).optional(),
      }),
      execute: async (request) =>
        traceToolCall(input.state, {
          toolName: "readEvidence",
          inputSummary: {
            ref: request.ref,
            offset: request.offset ?? 0,
            limit: request.limit ?? 4_000,
          },
          execute: async () =>
            input.ledger.read(
              request.ref,
              request.offset ?? 0,
              request.limit ?? 4_000,
            ),
          summarizeOutput: summarizeReadEvidenceOutput,
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

    finalize: tool({
      description:
        "Finalize the user-facing output manifest. This is the only final answer " +
        "contract. Artifacts listed here with display=true are the exact set of " +
        "images/tables shown to the user; cite only refs from the evidence ledger.",
      inputSchema: outputManifestSchema,
      execute: async (manifest) =>
        traceToolCall(input.state, {
          toolName: "finalize",
          inputSummary: summarizeManifest(manifest),
          execute: async () => {
            if (!input.state.intent) {
              return {
                ok: false as const,
                message: "declareIntent must be called before finalize.",
              }
            }
            if (!input.state.contextPolicy) {
              return {
                ok: false as const,
                message: "setContextPolicy must be called before finalize.",
              }
            }
            input.state.finalizedManifest = manifest
            input.state.finalized = true
            return { ok: true as const, ...manifest }
          },
          summarizeOutput: summarizeFinalizeOutput,
        }),
    }),
  } as const
}

async function inspectRetrievedImages(input: {
  readonly state: HarnessToolState
  readonly ledger: ReturnType<typeof createEvidenceLedger>
  readonly inspectImages?: InspectImages
  readonly refs: readonly string[]
  readonly question: string
}): Promise<
  | ({ readonly ok: true } & ImageInspectionResponse)
  | {
      readonly ok: false
      readonly message: string
      readonly inspected: readonly []
      readonly skipped: readonly {
        readonly ref: string
        readonly reason: string
      }[]
    }
> {
  const refs = getUniqueTrimmedRefs(input.refs)
  const question = input.question.trim()

  if (refs.length === 0 || question.length === 0) {
    return {
      ok: false,
      message: "At least one image asset ref and a question are required.",
      inspected: [],
      skipped: [],
    }
  }
  if (refs.length > imageInspectionRefLimit) {
    return {
      ok: false,
      message: `inspectImage accepts at most ${imageInspectionRefLimit} refs per call.`,
      inspected: [],
      skipped: refs.map((ref) => ({
        ref,
        reason: "Too many refs were requested in one inspectImage call.",
      })),
    }
  }

  const snapshot = input.ledger.snapshot()
  if (snapshot.retrievalCount === 0) {
    return {
      ok: false,
      message: "retrieve must be called before inspectImage.",
      inspected: [],
      skipped: refs.map((ref) => ({
        ref,
        reason: "No retrieval evidence is available yet.",
      })),
    }
  }
  if (!input.inspectImages) {
    return {
      ok: false,
      message: "Image inspection is not available for this turn.",
      inspected: [],
      skipped: refs.map((ref) => ({
        ref,
        reason: "No image inspection capability is configured.",
      })),
    }
  }

  const assetsByRef = new Map(
    snapshot.assets.map((asset) => [asset.ref, asset] as const),
  )
  const skipped: {
    readonly ref: string
    readonly reason: string
  }[] = []
  const selectedAssets: ImageInspectionAsset[] = []

  for (const ref of refs) {
    const asset = assetsByRef.get(ref)
    if (!asset) {
      skipped.push({
        ref,
        reason: "Ref was not returned by retrieve as an asset.",
      })
      continue
    }
    if (asset.type !== "image") {
      skipped.push({
        ref,
        reason: "Ref is not an image asset.",
      })
      continue
    }

    selectedAssets.push({
      ref: asset.ref,
      label: asset.label,
      ...(asset.assetUrl ? { assetUrl: asset.assetUrl } : {}),
      ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
      ...(asset.revisionKey ? { revisionKey: asset.revisionKey } : {}),
      source: asset.source,
    })
  }

  if (selectedAssets.length === 0) {
    return {
      ok: false,
      message: "No inspectable image asset refs were provided.",
      inspected: [],
      skipped,
    }
  }

  const inspectedImageRefs = input.state.inspectedImageRefs ?? []
  const inspectedCountAfterCall =
    inspectedImageRefs.length + selectedAssets.length
  if (inspectedCountAfterCall > imageInspectionRefLimit) {
    return {
      ok: false,
      message: `inspectImage accepts at most ${imageInspectionRefLimit} image refs per turn.`,
      inspected: [],
      skipped: selectedAssets.map((asset) => ({
        ref: asset.ref,
        reason: "The per-turn image inspection limit would be exceeded.",
      })),
    }
  }

  input.state.inspectedImageRefs = [
    ...inspectedImageRefs,
    ...selectedAssets.map((asset) => asset.ref),
  ]

  try {
    const response = await input.inspectImages({
      question,
      assets: selectedAssets,
    })
    return {
      ok: true,
      analysis: response.analysis,
      inspected: response.inspected,
      skipped: [...skipped, ...response.skipped],
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Image inspection failed: ${error.message}`
          : "Image inspection failed.",
      inspected: [],
      skipped: selectedAssets.map((asset) => ({
        ref: asset.ref,
        reason: "The image inspection request failed.",
      })),
    }
  }
}

function getUniqueTrimmedRefs(refs: readonly string[]): string[] {
  const normalizedRefs: string[] = []
  for (const ref of refs) {
    const normalizedRef = ref.trim()
    if (!normalizedRef || normalizedRefs.includes(normalizedRef)) continue
    normalizedRefs.push(normalizedRef)
  }
  return normalizedRefs
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

function summarizeRetrievalRequest(request: {
  readonly query: string
  readonly modalities?: readonly TargetModality[]
  readonly purpose?: string
  readonly topK?: number
  readonly signalPaths?: readonly string[]
  readonly filterMode?: string
  readonly threshold?: number
}): unknown {
  return {
    query: request.query,
    modalities: request.modalities ?? ["text"],
    purpose: request.purpose,
    topK: request.topK,
    signalPathCount: request.signalPaths?.length ?? 0,
    filterMode: request.filterMode,
    threshold: request.threshold,
  }
}

function summarizeRetrieveOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  return {
    ok: output.ok,
    retrievalCount: output.retrievalCount,
    stopReason: output.stopReason,
    failureReason: output.failureReason,
    chunkCount: Array.isArray(output.chunks) ? output.chunks.length : 0,
    assetCount: Array.isArray(output.assets) ? output.assets.length : 0,
  }
}

function summarizeReadEvidenceOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  return {
    found: output.found,
    ref: output.ref,
    contentLength: output.contentLength,
    offset: output.offset,
    limit: output.limit,
    hasMoreContent: output.hasMoreContent,
  }
}

function summarizeInspectImageRequest(request: {
  readonly refs: readonly string[]
  readonly question: string
}): unknown {
  return {
    refs: getUniqueTrimmedRefs(request.refs),
    questionLength: request.question.trim().length,
  }
}

function summarizeInspectImageOutput(output: unknown): unknown {
  if (!isRecord(output)) return output
  return {
    ok: output.ok,
    analysisLength:
      typeof output.analysis === "string" ? output.analysis.length : 0,
    inspectedCount: Array.isArray(output.inspected)
      ? output.inspected.length
      : 0,
    skippedCount: Array.isArray(output.skipped) ? output.skipped.length : 0,
    message: output.message,
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

function summarizeManifest(manifest: OutputManifest): unknown {
  return {
    textLength: manifest.text.length,
    citationCount: manifest.citations.length,
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

export function buildHarnessSystemPrompt(turn: AgentTurnInput): string {
  return [
    "You are the outer Knowhere Agent Harness.",
    "KNOWHERE is only an evidence provider. Do not infer or control its internal navigation algorithm.",
    "Your job is to understand intent, decide context use, optionally retrieve evidence, select evidence/artifacts, create source-backed derived tables when useful, and finalize an output manifest.",
    "",
    "Required workflow:",
    "1. Call declareIntent first. Capture constraints like a requested image/table count in constraints.desiredCount.",
    "2. Call setContextPolicy next, deciding how prior turns should influence this turn.",
    "3. When the policy needs prior-turn detail (references or corrections), call readPriorTurn for the relevant ids.",
    "4. Call retrieve only when evidence is needed. The query must be concise and self-contained.",
    "5. For pixel-level details, OCR, visual comparison, image verification, or when the likely answer is only visible on a retrieved page/image asset, call inspectImage only after retrieve returned image asset refs.",
    `6. inspectImage accepts at most ${imageInspectionRefLimit} image asset refs per call and per turn.`,
    "7. Use readEvidence only for chunk refs already in the evidence ledger.",
    "8. Call finalize with text, citations, artifacts, and unresolved issues. finalize requires declareIntent and setContextPolicy first.",
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
    "- citations and selected image/table artifact refs may only reference refs returned by retrieve (in the evidence ledger).",
    "- inspectImage observations are inspection notes, not new source refs. Final citations and displayed image artifacts must use the original retrieved image asset refs.",
    "- If text evidence identifies a relevant page/image but does not include the exact fact, inspect the returned image asset for OCR/detail before saying the answer is unavailable.",
    "- If evidence is insufficient, list it in unresolved instead of fabricating facts.",
    "- After a validation-feedback message, fix all listed issues and call finalize again.",
    `Surface: ${turn.surface}`,
    `Output capabilities: ${JSON.stringify(turn.outputCapabilities)}`,
    turn.sourceContext ? `Searchable source context:\n${turn.sourceContext}` : "",
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

function buildFallbackManifest(text: string): OutputManifest {
  return {
    text,
    citations: [],
    artifacts: [],
    unresolved: text ? [] : ["The agent did not finalize an output manifest."],
  }
}

export type { HarnessTrace }
