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
  KnowhereToolRuntime,
  OutputManifest,
} from "./types"

describe("agent harness runtime", () => {
  it("keeps KNOWHERE as an evidence provider instead of exposing internal navigation", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain("KNOWHERE is only an evidence provider")
    expect(prompt).toContain("Do not infer or control its internal navigation")
    expect(prompt).not.toContain("LegalAction")
    expect(prompt).not.toContain("navigation action")
  })

  it("tells the agent citation metadata is optional and ledger-resolved", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain(
      "Citation label and source metadata are optional",
    )
    expect(prompt).toContain(
      "Notebook resolves citation metadata from evidence refs when possible",
    )
    expect(prompt).not.toContain("must match the selected evidence ref exactly")
  })

  it("passes only outer retrieval parameters to KNOWHERE without planning-tool gating", async () => {
    const query = vi.fn<KnowhereToolRuntime["search"]>().mockResolvedValue(
      makeRetrievalResponse(),
    )
    const state: {
      toolCalls?: HarnessToolCallTrace[]
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      knowhereTools: makeKnowhereTools(query),
      recentTurns: [],
    })

    const result = await executeTool(tools.knowhere_search, {
      query: "q4 chart",
      targetContent: "image",
      topK: 2,
      purpose: "Find the two requested charts.",
    })

    expect(result).toContain('<knowhere operation="search" status="ok">')
    expect(result).toContain('ref="r1:result:1"')
    expect(result).toContain('ref="asset:r1:result:1"')
    expect(query).toHaveBeenCalledWith({
      query: "q4 chart",
      targetContent: "image",
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
      ["knowhere_search", true],
    ])
  })

  it("returns only newly searched evidence in each knowhere_search tool result", async () => {
    const query = vi
      .fn<KnowhereToolRuntime["search"]>()
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
      knowhereTools: makeKnowhereTools(query),
      recentTurns: [],
    })

    const firstResult = await executeTool(tools.knowhere_search, { query: "first" })
    const secondResult = await executeTool(tools.knowhere_search, { query: "second" })

    expect(firstResult).toContain('ref="r1:result:1"')
    expect(secondResult).toContain('retrievalCount="2"')
    expect(secondResult).toContain("Second evidence")
    expect(secondResult).toContain('ref="r2:result:1"')
    expect(JSON.stringify(secondResult)).not.toContain("r1:result:1")
    expect(ledger.snapshot().chunks.map((chunk) => chunk.ref)).toEqual([
      "r1:result:1",
      "r2:result:1",
    ])
  })

  it("rejects image inspection before retrieval has returned image assets", async () => {
    const inspectImages = vi.fn()
    const tools = createHarnessTools({
      state: {},
      ledger: createEvidenceLedger(),
      knowhereTools: makeKnowhereTools(),
      inspectImages,
      recentTurns: [],
    })

    const result = await executeTool(tools.inspectImage, {
      refs: ["asset:r1:result:1"],
      question: "What text is visible?",
    })

    expect(result).toEqual({
      ok: false,
      message:
        "Knowhere evidence tools must return image assets before inspectImage.",
      inspected: [],
      skipped: [
        {
          ref: "asset:r1:result:1",
          reason: "No Knowhere evidence is available yet.",
        },
      ],
    })
    expect(inspectImages).not.toHaveBeenCalled()
  })

  it("rejects image inspection refs that are unknown or not image assets", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeTableRetrievalResponse())
    const inspectImages = vi.fn()
    const tools = createHarnessTools({
      state: {},
      ledger,
      knowhereTools: makeKnowhereTools(),
      inspectImages,
      recentTurns: [],
    })

    const result = await executeTool(tools.inspectImage, {
      refs: ["asset:r1:result:1", "missing"],
      question: "What is in these images?",
    })

    expect(result).toEqual({
      ok: false,
      message: "No inspectable image asset refs were provided.",
      inspected: [],
      skipped: [
        {
          ref: "asset:r1:result:1",
          reason: "Ref is not an image asset.",
        },
        {
          ref: "missing",
          reason: "Ref was not returned by Knowhere as an asset.",
        },
      ],
    })
    expect(inspectImages).not.toHaveBeenCalled()
  })

  it("enforces the inspectImage six-ref limit", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeImageRetrievalResponse(7))
    const tools = createHarnessTools({
      state: {},
      ledger,
      knowhereTools: makeKnowhereTools(),
      inspectImages: vi.fn(),
      recentTurns: [],
    })

    const result = await executeTool(tools.inspectImage, {
      refs: Array.from({ length: 7 }, (_, index) => `asset:r1:result:${index + 1}`),
      question: "Compare these images.",
    })

    expect(result).toMatchObject({
      ok: false,
      message: "inspectImage accepts at most 6 refs per call.",
    })
  })

  it("calls the visual inspection capability with retrieved image ledger assets", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())
    const inspectImages = vi.fn().mockResolvedValue({
      analysis: "The image shows a Q4 revenue chart with a rising line.",
      inspected: [
        {
          ref: "asset:r1:result:1",
          label: "report.pdf / images/chart.png / image",
        },
      ],
      skipped: [],
    })
    const tools = createHarnessTools({
      state: {},
      ledger,
      knowhereTools: makeKnowhereTools(),
      inspectImages,
      recentTurns: [],
    })

    const result = await executeTool(tools.inspectImage, {
      refs: ["asset:r1:result:1"],
      question: "What does the chart show?",
    })

    expect(inspectImages).toHaveBeenCalledWith({
      question: "What does the chart show?",
      assets: [
        {
          ref: "asset:r1:result:1",
          label: "report.pdf / images/chart.png / image",
          assetUrl: "https://assets.example/chart.png",
          sourcePath: "images/chart.png",
          source: {
            documentId: "doc_1",
            sourceFileName: "report.pdf",
            sectionPath: "images/chart.png",
          },
        },
      ],
    })
    expect(result).toEqual({
      ok: true,
      analysis: "The image shows a Q4 revenue chart with a rising line.",
      inspected: [
        {
          ref: "asset:r1:result:1",
          label: "report.pdf / images/chart.png / image",
        },
      ],
      skipped: [],
    })
  })

  it("calls the visual inspection capability with retrieved page citation assets", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makePageCitationRetrievalResponse())
    const inspectImages = vi.fn().mockResolvedValue({
      analysis: "The clause says the contractor pays 5000 yuan per occurrence.",
      inspected: [
        {
          ref: "asset:r1:referenced:1",
          label:
            "Root / （6）现场工期进度管理方面的违约责任 / page_citation_assets/page-8.png / page",
        },
      ],
      skipped: [],
    })
    const tools = createHarnessTools({
      state: {},
      ledger,
      knowhereTools: makeKnowhereTools(),
      inspectImages,
      recentTurns: [],
    })

    const result = await executeTool(tools.inspectImage, {
      refs: ["asset:r1:referenced:1"],
      question: "What liquidated damages amount is visible in this clause?",
    })

    expect(inspectImages).toHaveBeenCalledWith({
      question: "What liquidated damages amount is visible in this clause?",
      assets: [
        {
          ref: "asset:r1:referenced:1",
          label:
            "Root / （6）现场工期进度管理方面的违约责任 / page_citation_assets/page-8.png / page",
          assetUrl: "https://assets.example/page-8.png",
          sourcePath: "page_citation_assets/page-8.png",
          revisionKey: "job_contract",
          source: {
            documentId: "doc_contract",
            sourceFileName: null,
            sectionPath: "Root / （6）现场工期进度管理方面的违约责任",
          },
        },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      analysis: "The clause says the contractor pays 5000 yuan per occurrence.",
    })
  })

  it("accepts finalize output without planning-tool gating", async () => {
    const state: {
      finalizedManifest?: OutputManifest
      finalized?: boolean
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    const manifest = {
      text: "Answer.",
      citations: [],
      artifacts: [],
      unresolved: [],
    }

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
      knowhereTools: makeKnowhereTools(),
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
      knowhereTools: makeKnowhereTools(),
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
            toolName: "knowhere_search",
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
            toolName: "knowhere_search",
            output: {
              type: "text",
              value: '<knowhere operation="search" status="ok"></knowhere>',
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
            toolName: "knowhere_search",
            output: {
              type: "text",
              value: '<knowhere operation="search" status="ok"></knowhere>',
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

  it("forces image inspection before forced finalization when image assets are available", () => {
    const result = prepareHarnessStep({
      stepNumber: 12,
      hasUninspectedImageAssets: true,
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "knowhere_search",
              output: {
                type: "text",
                value:
                  '<knowhere operation="search" status="ok"><asset ref="asset:r1:referenced:1" type="image" /></knowhere>',
              },
            },
          ],
        },
      ],
    })

    expect(result.activeTools).toEqual(["inspectImage"])
    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: "inspectImage",
    })
    expect(result.messages).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "knowhere_search",
            output: {
              type: "text",
              value:
                '<knowhere operation="search" status="ok"><asset ref="asset:r1:referenced:1" type="image" /></knowhere>',
            },
          },
        ],
      },
      {
        role: "user",
        content: expect.stringContaining("call inspectImage now"),
      },
    ])
  })

  it("forces finalize at step 13 using existing tool results", () => {
    const result = prepareHarnessStep({
      stepNumber: 13,
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "knowhere_search",
              output: {
                type: "text",
                value:
                  '<knowhere operation="search" status="ok"><chunk ref="r1:result:1"></chunk></knowhere>',
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
            toolName: "knowhere_search",
            output: {
              type: "text",
              value:
                '<knowhere operation="search" status="ok"><chunk ref="r1:result:1"></chunk></knowhere>',
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

function makeKnowhereTools(
  search: KnowhereToolRuntime["search"] = vi.fn(),
): KnowhereToolRuntime {
  return {
    search,
    listDocuments: vi.fn().mockResolvedValue({ documents: [] }),
    getDocumentOutline: vi.fn().mockRejectedValue(new Error("Not configured.")),
    readChunks: vi.fn().mockRejectedValue(new Error("Not configured.")),
    grepChunks: vi.fn().mockRejectedValue(new Error("Not configured.")),
  }
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

function makeTableRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "q4 table",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Table evidence",
    stopReason: "answer_done",
    failureReason: null,
    results: [
      {
        content: "",
        chunkType: "table",
        score: 0.8,
        assetUrl: "https://assets.example/tables/revenue.html",
        source: {
          documentId: "doc_1",
          sourceFileName: "report.pdf",
          sectionPath: "tables/revenue.html",
        },
      },
    ],
    referencedChunks: [],
  }
}

function makeImageRetrievalResponse(count: number): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "q4 images",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Image evidence",
    stopReason: "answer_done",
    failureReason: null,
    results: Array.from({ length: count }, (_, index) => ({
      content: "",
      chunkType: "image",
      score: 0.8,
      assetUrl: `https://assets.example/images/chart-${index + 1}.png`,
      source: {
        documentId: "doc_1",
        sourceFileName: "report.pdf",
        sectionPath: `images/chart-${index + 1}.png`,
      },
    })),
    referencedChunks: [],
  }
}

function makePageCitationRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "进度计划",
    routerUsed: "workflow_single_step",
    answerText: null,
    evidenceText: "Root / （6）现场工期进度管理方面的违约责任",
    stopReason: "answer_done",
    failureReason: null,
    results: [],
    referencedChunks: [
      {
        chunkId: "chunk_page_8",
        documentId: "doc_contract",
        chunkType: "page",
        sectionPath: "Root / （6）现场工期进度管理方面的违约责任",
        filePath: null,
        jobId: "job_contract",
        assetUrl: "https://assets.example/page-8.png",
        metadata: {
          pageNums: [8],
          pageAssets: [
            {
              pageNum: 8,
              artifactRef: "page_citation_assets/page-8.png",
              assetUrl: "https://assets.example/page-8.png",
              contentType: "image/png",
            },
          ],
        },
      },
    ],
  }
}
