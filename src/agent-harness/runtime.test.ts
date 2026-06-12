import { describe, expect, it, vi } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"

import {
  buildHarnessMessages,
  buildHarnessSystemPrompt,
  createHarnessTools,
} from "./runtime"
import { createEvidenceLedger } from "./ledger"
import type {
  AgentTurnInput,
  ContextPolicy,
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
  })

  it("blocks finalize until intent and context policy are declared", async () => {
    const state: {
      intent?: IntentFrame
      contextPolicy?: ContextPolicy
      finalizedManifest?: OutputManifest
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
  })

  it("exposes full prior-turn content on demand through readPriorTurn", async () => {
    const tools = createHarnessTools({
      state: {},
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
    expect(await executeTool(tools.readPriorTurn, { id: "missing" })).toEqual({
      found: false,
      id: "missing",
      message: "No prior turn with that id is available.",
    })
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
