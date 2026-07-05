import { describe, expect, it, vi } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import {
  buildHarnessMessages,
  buildHarnessSystemPrompt,
  createHarnessTools,
  prepareHarnessStep,
  sanitizeHarnessModelMessagesForStep,
} from "./runtime"
import { createEvidenceLedger } from "./ledger"
import type {
  AgentTurnInput,
  ContextPolicy,
  HarnessToolCallTrace,
  IntentFrame,
  OutputManifest,
  RetrievalCapability,
} from "./types"

describe("agent harness runtime", () => {
  it("keeps KNOWHERE as an evidence provider instead of exposing internal navigation", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain("KNOWHERE is only an evidence provider")
    expect(prompt).toContain("Do not infer or control its internal navigation")
    expect(prompt).not.toContain("LegalAction")
    expect(prompt).not.toContain("navigation action")
  })

  it("passes only outer retrieval parameters to KNOWHERE after intent and context policy are declared", async () => {
    const query = vi.fn<RetrievalCapability["query"]>().mockResolvedValue(
      makeRetrievalResponse(),
    )
    const state: {
      intent?: IntentFrame
      contextPolicy?: ContextPolicy
      toolCalls?: HarnessToolCallTrace[]
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      retrieval: { query },
      recentTurns: [],
    })

    expect(await executeTool(tools.retrieve, { query: "q4 chart" })).toEqual({
      ok: false,
      message: "declareIntent must be called before retrieve.",
    })

    await executeTool(tools.declareIntent, {
      task: "show_media",
      dependsOnPreviousTurn: false,
      retrievalNeeded: "yes",
      targetModalities: ["image"],
      constraints: { desiredCount: 2, maxCount: 2 },
      groundingPolicy: "must_use_sources",
    })
    expect(await executeTool(tools.retrieve, { query: "q4 chart" })).toEqual({
      ok: false,
      message: "setContextPolicy must be called before retrieve.",
    })

    await executeTool(tools.setContextPolicy, {
      carryHistory: "none",
      reason: "The current request is unrelated to previous turns.",
      activePriorTurnIds: [],
    })
    const result = await executeTool(tools.retrieve, {
      query: "q4 chart",
      modalities: ["image"],
      topK: 2,
      purpose: "Find the two requested charts.",
    })

    expect(result).toMatchObject({
      ok: true,
      retrievalCount: 1,
    })
    expect(query).toHaveBeenCalledWith({
      query: "q4 chart",
      modalities: ["image"],
      topK: 2,
      purpose: "Find the two requested charts.",
      signalPaths: undefined,
      filterMode: undefined,
      threshold: undefined,
    })
    expect(JSON.stringify(query.mock.calls[0]?.[0])).not.toContain(
      "LegalAction",
    )
    expect(state.toolCalls?.map((call) => [call.tool, call.ok])).toEqual([
      ["retrieve", false],
      ["declareIntent", true],
      ["retrieve", false],
      ["setContextPolicy", true],
      ["retrieve", true],
    ])
  })

  it("returns only newly retrieved evidence in each retrieve tool result", async () => {
    const query = vi
      .fn<RetrievalCapability["query"]>()
      .mockResolvedValueOnce(makeRetrievalResponse())
      .mockResolvedValueOnce({
        ...makeRetrievalResponse(),
        query: "second query",
        evidenceText: "Second evidence",
        results: [
          {
            content: "Second retrieval evidence.",
            chunkType: "text",
            score: 0.8,
            source: {
              documentId: "doc_2",
              sourceFileName: "second.pdf",
              sectionPath: "Second",
            },
          },
        ],
      })
    const state: {
      intent?: IntentFrame
      contextPolicy?: ContextPolicy
      toolCalls?: HarnessToolCallTrace[]
    } = {
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "yes",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "must_use_sources",
      },
      contextPolicy: {
        carryHistory: "none",
        reason: "Self-contained request.",
        activePriorTurnIds: [],
      },
    }
    const ledger = createEvidenceLedger()
    const tools = createHarnessTools({
      state,
      ledger,
      retrieval: { query },
      recentTurns: [],
    })

    const firstResult = await executeTool(tools.retrieve, { query: "first" })
    const secondResult = await executeTool(tools.retrieve, { query: "second" })

    expect(firstResult).toMatchObject({
      retrievalCount: 1,
      chunks: [{ ref: "r1:result:1" }],
    })
    expect(secondResult).toMatchObject({
      retrievalCount: 2,
      evidenceText: "Second evidence",
      chunks: [{ ref: "r2:result:1" }],
    })
    expect(JSON.stringify(secondResult)).not.toContain("r1:result:1")
    expect(ledger.snapshot().chunks.map((chunk) => chunk.ref)).toEqual([
      "r1:result:1",
      "r2:result:1",
    ])
  })

  it("blocks finalize until intent and context policy are declared", async () => {
    const state: {
      intent?: IntentFrame
      contextPolicy?: ContextPolicy
      finalizedManifest?: OutputManifest
      finalized?: boolean
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      retrieval: { query: vi.fn<RetrievalCapability["query"]>() },
      recentTurns: [],
    })

    const manifest = {
      text: "Answer.",
      citations: [],
      artifacts: [],
      unresolved: [],
    }

    expect(await executeTool(tools.finalize, manifest)).toEqual({
      ok: false,
      message: "declareIntent must be called before finalize.",
    })
    expect(state.finalizedManifest).toBeUndefined()

    await executeTool(tools.declareIntent, {
      task: "answer_question",
      dependsOnPreviousTurn: false,
      retrievalNeeded: "no",
      targetModalities: ["text"],
      constraints: {},
      groundingPolicy: "may_use_sources",
    })
    expect(await executeTool(tools.finalize, manifest)).toEqual({
      ok: false,
      message: "setContextPolicy must be called before finalize.",
    })
    expect(state.finalizedManifest).toBeUndefined()

    await executeTool(tools.setContextPolicy, {
      carryHistory: "none",
      reason: "Self-contained request.",
      activePriorTurnIds: [],
    })
    expect(await executeTool(tools.finalize, manifest)).toMatchObject({
      ok: true,
      text: "Answer.",
    })
    expect(state.finalizedManifest).toEqual(manifest)
    expect(state.finalized).toBe(true)
  })

  it("exposes full prior-turn content through policy-approved readPriorTurn", async () => {
    const state: {
      contextPolicy?: ContextPolicy
      priorTurnReads?: string[]
    } = {
      contextPolicy: {
        carryHistory: "repair_previous",
        reason: "The current request corrects the previous answer.",
        activePriorTurnIds: ["turn_1"],
      },
      priorTurnReads: [],
    }
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      retrieval: { query: vi.fn<RetrievalCapability["query"]>() },
      recentTurns: [
        {
          id: "turn_1",
          role: "assistant",
          contentPreview: "Truncated preview...",
          content: "The full earlier answer about the tax filing deadline.",
          citationLabels: ["tax.pdf / deadline"],
        },
      ],
    })

    expect(await executeTool(tools.readPriorTurn, { id: "turn_1" })).toEqual({
      found: true,
      id: "turn_1",
      role: "assistant",
      content: "The full earlier answer about the tax filing deadline.",
      citationLabels: ["tax.pdf / deadline"],
    })
    expect(state.priorTurnReads).toEqual(["turn_1"])
    expect(await executeTool(tools.readPriorTurn, { id: "missing" })).toEqual({
      found: false,
      id: "missing",
      message: "readPriorTurn id must be listed in activePriorTurnIds.",
    })
  })

  it("blocks prior-turn reads when the context policy does not allow them", async () => {
    const state: { contextPolicy?: ContextPolicy; priorTurnReads?: string[] } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      retrieval: { query: vi.fn<RetrievalCapability["query"]>() },
      recentTurns: [
        {
          id: "turn_1",
          role: "assistant",
          contentPreview: "Truncated preview...",
          content: "Full content.",
        },
      ],
    })

    expect(await executeTool(tools.readPriorTurn, { id: "turn_1" })).toEqual({
      found: false,
      id: "turn_1",
      message: "setContextPolicy must be called before readPriorTurn.",
    })

    state.contextPolicy = {
      carryHistory: "none",
      reason: "The current request is unrelated to previous turns.",
      activePriorTurnIds: [],
    }
    expect(await executeTool(tools.readPriorTurn, { id: "turn_1" })).toEqual({
      found: false,
      id: "turn_1",
      message: "readPriorTurn is not allowed when carryHistory is none.",
    })
    expect(state.priorTurnReads).toBeUndefined()
  })

  it("summarizes recent turns as an index instead of pasting full history as query context", () => {
    const messages = buildHarnessMessages(
      makeTurnInput({
        recentTurns: [
          {
            id: "turn_1",
            role: "assistant",
            contentPreview: "First answer about tax filing.",
            citationLabels: ["tax.pdf / deadline"],
          },
        ],
      }),
    )

    expect(messages).toEqual([
      {
        role: "user",
        content: expect.stringContaining("Recent turn index:"),
      },
    ])
    expect(JSON.stringify(messages)).toContain("id=turn_1 role=assistant")
    expect(JSON.stringify(messages)).not.toContain("searchSources.query")
  })

  it("removes provider metadata from tool-result parts while preserving tool-call metadata", () => {
    const messages = sanitizeHarnessModelMessagesForStep([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "retrieve",
            input: { query: "q4" },
            providerOptions: {
              google: {
                thoughtSignature: "signature-1",
              },
            },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "retrieve",
            output: {
              type: "json",
              value: {
                ok: true,
              },
            },
            providerOptions: {
              google: {
                thoughtSignature: "signature-1",
              },
            },
          },
        ],
      },
    ])

    expect(messages).toEqual([
      {
        role: "assistant",
        content: [
          expect.objectContaining({
            type: "tool-call",
            providerOptions: {
              google: {
                thoughtSignature: "signature-1",
              },
            },
          }),
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "retrieve",
            output: {
              type: "json",
              value: {
                ok: true,
              },
            },
          },
        ],
      },
    ])
  })

  it("keeps normal steps unconstrained before the finalization step", () => {
    const result = prepareHarnessStep({
      stepNumber: 11,
      messages: [
        {
          role: "user",
          content: "Find the penalty amount.",
        },
      ],
    })

    expect(result).toEqual({
      messages: [
        {
          role: "user",
          content: "Find the penalty amount.",
        },
      ],
    })
  })

  it("forces finalize at step 12 using existing tool results", () => {
    const result = prepareHarnessStep({
      stepNumber: 12,
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "retrieve",
              output: {
                type: "json",
                value: {
                  ok: true,
                  chunks: [{ ref: "r1:result:1" }],
                },
              },
              providerOptions: {
                google: {
                  thoughtSignature: "signature-1",
                },
              },
            },
          ],
        },
      ],
    })

    expect(result.activeTools).toEqual(["finalize"])
    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: "finalize",
    })
    expect(result.messages).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "retrieve",
            output: {
              type: "json",
              value: {
                ok: true,
                chunks: [{ ref: "r1:result:1" }],
              },
            },
          },
        ],
      },
      {
        role: "user",
        content: expect.stringContaining(
          "Use only the evidence and tool results already available",
        ),
      },
    ])
  })
})

function executeTool(tool: unknown, input: unknown): Promise<unknown> {
  return (tool as { execute: (input: unknown) => Promise<unknown> }).execute(input)
}

function makeTurnInput(overrides: Partial<AgentTurnInput> = {}): AgentTurnInput {
  return {
    surface: "notebook_chat",
    userText: "Show me two Q4 chart images.",
    recentTurns: [],
    outputCapabilities: {
      text: true,
      image: true,
      table: true,
    },
    ...overrides,
  }
}

function makeRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "q4 chart",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Chart evidence",
    stopReason: "answer_done",
    failureReason: null,
    results: [
      {
        content: "",
        chunkType: "image",
        score: 0.9,
        assetUrl: "https://assets.example/chart.png",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "images/chart.png",
        },
      },
    ],
    referencedChunks: [],
  }
}
