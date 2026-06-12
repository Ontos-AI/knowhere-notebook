import { stepCountIs, ToolLoopAgent, tool, type ModelMessage } from "ai"
import { z } from "zod"

import { createEvidenceLedger } from "./ledger"
import type {
  AgentTurn,
  AgentTurnInput,
  ContextPolicy,
  HarnessRunResult,
  HarnessTrace,
  IntentFrame,
  OutputManifest,
  RetrievalCapability,
  TargetModality,
} from "./types"
import { validateOutputManifest } from "./validator"

const defaultMaxSteps = 10
const defaultMaxRevisions = 1

type ToolLoopAgentSettings = ConstructorParameters<typeof ToolLoopAgent>[0]

export type AgentHarnessModel = ToolLoopAgentSettings["model"]

export type RunAgentHarnessInput = {
  readonly model: AgentHarnessModel
  readonly turn: AgentTurnInput
  readonly retrieval: RetrievalCapability
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

const outputArtifactSchema = z.object({
  type: z.enum(["image", "table"]),
  ref: z.string().min(1),
  display: z.boolean(),
  reason: z.string().min(1),
})

const outputManifestSchema = z.object({
  text: z.string(),
  citations: z.array(outputCitationSchema).default([]),
  artifacts: z.array(outputArtifactSchema).default([]),
  unresolved: z.array(z.string()).default([]),
})

export async function runAgentHarness(
  input: RunAgentHarnessInput,
): Promise<HarnessRunResult> {
  const state: HarnessToolState = {}
  const ledger = createEvidenceLedger()
  const tools = createHarnessTools({
    state,
    ledger,
    retrieval: input.retrieval,
    recentTurns: input.turn.recentTurns,
  })
  const agent = new ToolLoopAgent({
    model: input.model,
    instructions: buildHarnessSystemPrompt(input.turn),
    tools,
    stopWhen: stepCountIs(input.maxSteps ?? defaultMaxSteps),
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
      ledger: ledger.snapshot(),
      surface: input.turn.surface,
    })
    validationErrors = validation.errors

    if (validation.ok || attempt >= maxRevisions) break

    // Self-correction (reflexion): continue the same conversation with
    // structured validator feedback and require a fresh finalize so the agent
    // can repair its own contract violations instead of shipping them.
    revisionsUsed += 1
    state.finalizedManifest = undefined
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
      validationErrors,
      revisionsUsed,
    },
  }
}

function buildRevisionFeedback(errors: readonly string[]): string {
  return [
    "Your finalize output did not satisfy the output contract:",
    ...errors.map((error) => `- ${error}`),
    "",
    "Fix every issue and call finalize again with a corrected manifest.",
    "Do not exceed the user's requested artifact count, only cite or display",
    "evidence refs that exist in the evidence ledger, and do not fabricate",
    "facts when evidence is missing.",
  ].join("\n")
}

export function createHarnessTools(input: {
  readonly state: HarnessToolState
  readonly ledger: ReturnType<typeof createEvidenceLedger>
  readonly retrieval: RetrievalCapability
  readonly recentTurns: readonly AgentTurn[]
}) {
  return {
    declareIntent: tool({
      description:
        "Declare the user's intent before any other action. This is working memory, not a final answer.",
      inputSchema: intentFrameSchema,
      execute: async (intent): Promise<IntentFrame> => {
        input.state.intent = intent
        return intent
      },
    }),

    setContextPolicy: tool({
      description:
        "Decide whether prior turns should influence this turn. Use none for unrelated follow-ups.",
      inputSchema: contextPolicySchema,
      execute: async (policy): Promise<ContextPolicy> => {
        input.state.contextPolicy = policy
        return policy
      },
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
      execute: async (request) => {
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
        return {
          ok: true,
          retrievalCount: snapshot.retrievalCount,
          evidenceText: response.evidenceText ?? "",
          stopReason: response.stopReason ?? null,
          failureReason: response.failureReason ?? null,
          chunks: snapshot.chunks.map((chunk) => ({
            ref: chunk.ref,
            kind: chunk.kind,
            type: chunk.chunkType,
            preview: chunk.contentPreview,
            source: chunk.source,
            assetRef: chunk.assetRef,
          })),
          assets: snapshot.assets.map((asset) => ({
            ref: asset.ref,
            type: asset.type,
            label: asset.label,
            source: asset.source,
          })),
        }
      },
    }),

    readEvidence: tool({
      description:
        "Read more text from an evidence chunk already returned by KNOWHERE.",
      inputSchema: z.object({
        ref: z.string().min(1),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(8_000).optional(),
      }),
      execute: async ({ ref, offset = 0, limit = 4_000 }) =>
        input.ledger.read(ref, offset, limit),
    }),

    readPriorTurn: tool({
      description:
        "Read the full text and citation labels of a specific prior turn by id " +
        "(ids come from the recent turn index). Use this only when the current " +
        "request depends on, references, or corrects a previous turn.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      execute: async ({ id }) => {
        const priorTurn = input.recentTurns.find((turn) => turn.id === id)
        if (!priorTurn) {
          return {
            found: false as const,
            id,
            message: "No prior turn with that id is available.",
          }
        }
        return {
          found: true as const,
          id,
          role: priorTurn.role,
          content: priorTurn.content ?? priorTurn.contentPreview,
          citationLabels: priorTurn.citationLabels ?? [],
        }
      },
    }),

    finalize: tool({
      description:
        "Finalize the user-facing output manifest. This is the only final answer " +
        "contract. Artifacts listed here with display=true are the exact set of " +
        "images/tables shown to the user; cite only refs from the evidence ledger.",
      inputSchema: outputManifestSchema,
      execute: async (manifest) => {
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
        return { ok: true as const, ...manifest }
      },
    }),
  } as const
}

export function buildHarnessSystemPrompt(turn: AgentTurnInput): string {
  return [
    "You are the outer Knowhere Agent Harness.",
    "KNOWHERE is only an evidence provider. Do not infer or control its internal navigation algorithm.",
    "Your job is to understand intent, decide context use, optionally retrieve evidence, select evidence/artifacts, and finalize an output manifest.",
    "",
    "Required workflow:",
    "1. Call declareIntent first. Capture constraints like a requested image/table count in constraints.desiredCount.",
    "2. Call setContextPolicy next, deciding how prior turns should influence this turn.",
    "3. When the policy needs prior-turn detail (references or corrections), call readPriorTurn for the relevant ids.",
    "4. Call retrieve only when evidence is needed. The query must be concise and self-contained.",
    "5. Use readEvidence only for chunk refs already in the evidence ledger.",
    "6. Call finalize with text, citations, artifacts, and unresolved issues. finalize requires declareIntent and setContextPolicy first.",
    "",
    "Context rules:",
    "- If the current user request is unrelated to prior turns, set carryHistory to none and do not reuse prior topics.",
    "- If the user corrects a previous answer, set carryHistory to repair_previous, read the relevant prior turn, then re-retrieve and re-answer using the correction.",
    "- If the user uses references like this document, that image, or the previous answer, choose referential_only or full_recent and read the prior turn you depend on.",
    "",
    "Output rules:",
    "- Final output is the OutputManifest passed to finalize, not freeform tool JSON or trailing text.",
    "- artifacts with display=true are the exact images/tables shown. Never display every candidate; honor constraints.desiredCount / maxCount.",
    "- citations and artifacts may only reference refs returned by retrieve (in the evidence ledger).",
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
