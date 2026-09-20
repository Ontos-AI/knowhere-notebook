import { describe, expect, it, vi } from "vitest"
import type { RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"
import { MockLanguageModelV3 } from "ai/test"

import {
  buildHarnessMessages,
  buildHarnessSystemPrompt,
  createHarnessTools,
  prepareHarnessStep,
  runAgentHarness,
  sanitizeHarnessModelMessagesForStep,
} from "./runtime"
import { createEvidenceLedger } from "./ledger"
import type {
  AgentTurnInput,
  ContextPolicy,
  HarnessToolCallTrace,
  IntentFrame,
  KnowhereToolRuntime,
  MemorySearchItem,
  MemoryToolRuntime,
  OutputManifest,
  ResolveConnectedAssets,
} from "./types"

describe("agent harness runtime", () => {
  it("runs retention, resolves connected assets, assembles once, and finalizes", async () => {
    const modelResults = [
      toolCallResult([
        {
          toolCallId: "intent",
          toolName: "declareIntent",
          input: {
            task: "compare",
            dependsOnPreviousTurn: false,
            retrievalNeeded: "yes",
            targetModalities: ["text", "image", "table"],
            constraints: {},
            groundingPolicy: "must_use_sources",
          },
        },
        {
          toolCallId: "context",
          toolName: "setContextPolicy",
          input: {
            carryHistory: "none",
            reason: "Self-contained request.",
            activePriorTurnIds: [],
          },
        },
      ]),
      toolCallResult([
        {
          toolCallId: "search",
          toolName: "knowhere_search",
          input: { query: "comparison", targetContent: "all" },
        },
      ]),
      toolCallResult([
        {
          toolCallId: "retain",
          toolName: "retainEvidence",
          input: { picks: [1] },
        },
      ]),
      toolCallResult([
        {
          toolCallId: "prepare",
          toolName: "prepareAnswer",
          input: {},
        },
      ]),
      toolCallResult([
        {
          toolCallId: "finalize",
          toolName: "finalize",
          input: {
            text: "Comparison [[cite:1]].",
            citations: [{ pick: 1 }],
            memoryCitations: [],
            artifacts: [
              {
                type: "table",
                ref: "asset:r1:result:1:table_chunk",
                display: true,
                reason: "Comparison table",
              },
              {
                type: "image",
                ref: "asset:r1:result:1:image_chunk",
                display: true,
                reason: "Comparison image",
              },
            ],
            unresolved: [],
          },
        },
      ]),
    ]
    let modelResultIndex = 0
    const model = new MockLanguageModelV3({
      supportedUrls: { "image/*": [/^https:\/\//] },
      doGenerate: async () => {
        const result = modelResults[modelResultIndex]
        modelResultIndex += 1
        if (!result) throw new Error("No mock model result remains.")
        return result
      },
    })
    const resolveConnectedAssets = vi.fn<ResolveConnectedAssets>(
      async (lookups) =>
        lookups.map((lookup) => ({
          ...lookup,
          assetUrl: `https://assets.example/${lookup.chunkId}`,
        })),
    )
    const readTableHtml = vi
      .fn()
      .mockResolvedValue("<table><tr><td>comparison</td></tr></table>")

    const result = await runAgentHarness({
      model,
      turn: makeTurnInput(),
      knowhereTools: makeKnowhereTools(
        vi.fn().mockResolvedValue(makeConnectedRetrievalResponse()),
      ),
      memoryTools: makeMemoryTools(),
      resolveConnectedAssets,
      readTableHtml,
    })

    expect(model.doGenerateCalls).toHaveLength(5)
    expect(resolveConnectedAssets).toHaveBeenCalledWith([
      { documentId: "doc_1", chunkId: "table_chunk", type: "table" },
      { documentId: "doc_1", chunkId: "image_chunk", type: "image" },
    ])
    expect(readTableHtml).toHaveBeenCalledWith(
      "https://assets.example/table_chunk",
    )
    expect(JSON.stringify(model.doGenerateCalls[4]?.prompt)).toContain(
      "<table><tr><td>comparison</td></tr></table>",
    )
    expect(result.manifest.citations).toEqual([{ ref: "r1:result:1" }])
    expect(result.trace.ledger.assets).toHaveLength(2)
  })

  it("tells the agent to search memory and documents in parallel when both apply", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain("call them together in the same step")
    expect(prompt).toContain(
      "Call knowhere_search once per turn when groundingPolicy requires citing source documents",
    )
    expect(prompt).toContain("Call knowhere_search once; do not change the query and search again")
    expect(prompt).not.toContain("call knowhere_search again with a refined query")
    expect(prompt).not.toContain("Refine knowhere_search at most twice")
    expect(prompt).not.toContain("gapReason")
    expect(prompt).toContain(
      "After a search that returns new evidence, call retainEvidence",
    )
    expect(prompt).toContain(
      "asset paths in retrieved chunks represent connected assets",
    )
    expect(prompt).toContain(
      "Do not search again because those assets have not been expanded yet",
    )
    expect(prompt).not.toContain("knowhere_list_documents")
    expect(prompt).not.toContain("knowhere_get_document_outline")
    expect(prompt).not.toContain("knowhere_read_chunks")
    expect(prompt).not.toContain("knowhere_grep_chunks")
    expect(prompt).toContain(
      "Do not treat every question as a document-retrieval task",
    )
  })

  it("keeps KNOWHERE as an evidence provider instead of exposing internal navigation", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain("KNOWHERE is only an evidence provider")
    expect(prompt).toContain("Do not infer or control its internal navigation")
    expect(prompt).not.toContain("LegalAction")
    expect(prompt).not.toContain("navigation action")
  })

  it("tells the agent to cite by search-chunk pick numbers", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain("citations is a list of { pick }")
    expect(prompt).toContain("Notebook writes the citation list from those picks")
    expect(prompt).toContain("Do not pass documentId or evidence refs as citations")
    expect(prompt).not.toContain("Citation refs must be evidence refs")
    expect(prompt).not.toContain("Citation label and source metadata are optional")
  })

  it("tells the agent to emit [[cite:n]] markers instead of title/pN or [1]", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain("[[cite:n]]")
    expect(prompt).toContain("1-based index into the citations array")
    expect(prompt).toContain("Do not write title/pN, [1], Markdown footnotes")
    expect(prompt).toContain("Never group indices as [[cite:1, 3, 5]]")
    expect(prompt).toContain("Do not collapse same-page citations")
  })

  it("tells the agent to read retained images in the assembled answer message", () => {
    const prompt = buildHarnessSystemPrompt(makeTurnInput())

    expect(prompt).toContain(
      "memory_search and knowhere_search are parallel retrieval sources",
    )
    expect(prompt).toContain(
      "Images in retained evidence are embedded directly",
    )
    expect(prompt).not.toContain("inspectImage")
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
      memoryTools: makeMemoryTools(),
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
    expect(result).toContain('pick="1"')
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

  it.each([
    { includeDocumentIds: ["doc_1"], excludeDocumentIds: ["doc_2"] },
    { includeDocumentIds: [], excludeDocumentIds: [] },
  ])("preserves document scopes in the actual search tool: %j", async (scope) => {
    const search = vi.fn<KnowhereToolRuntime["search"]>().mockResolvedValue(makeRetrievalResponse())
    const tools = createHarnessTools({
      state: {}, ledger: createEvidenceLedger(), recentTurns: [],
      memoryTools: makeMemoryTools(), knowhereTools: makeKnowhereTools(search),
    })
    await executeTool(tools.knowhere_search, { query: "question", ...scope })
    expect(search).toHaveBeenCalledWith(expect.objectContaining(scope))
  })

  it("returns newly searched evidence from the one knowhere_search and rejects a second call", async () => {
    const query = vi
      .fn<KnowhereToolRuntime["search"]>()
      .mockResolvedValueOnce(makeRetrievalResponse())
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
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(query),
      recentTurns: [],
    })

    const firstResult = await executeTool(tools.knowhere_search, { query: "first" })
    await retainLatestSearch(tools, ledger)
    const secondResult = await executeTool(tools.knowhere_search, {
      query: "second",
    })

    expect(firstResult).toContain('pick="1"')
    expect(firstResult).toContain('ref="r1:result:1"')
    expect(secondResult).toContain('status="error"')
    expect(String(secondResult)).toContain("already ran for this turn")
    expect(query).toHaveBeenCalledTimes(1)
    expect(ledger.snapshot().chunks.map((chunk) => chunk.ref)).toEqual([
      "r1:result:1",
    ])
  })

  it("writes citation refs from ledger picks and rejects picks outside the ledger", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())
    const state: {
      finalized?: boolean
      finalizedManifest?: OutputManifest
    } = {}
    const tools = createHarnessTools({
      state,
      ledger,
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })
    await retainLatestSearch(tools, ledger)

    const rejected = await executeTool(tools.finalize, {
      text: "Target is <130/80 mmHg [[cite:1]].",
      citations: [{ pick: 99 }],
      memoryCitations: [],
      artifacts: [],
      unresolved: [],
    })

    expect(rejected).toMatchObject({
      ok: false,
      unknownPicks: [99],
    })
    expect(String((rejected as { message: string }).message)).toContain(
      "Available picks: 1-1",
    )
    expect(state.finalized).not.toBe(true)

    const accepted = await executeTool(tools.finalize, {
      text: "Target is <130/80 mmHg [[cite:1]].",
      citations: [{ pick: 1 }],
      memoryCitations: [],
      artifacts: [],
      unresolved: [],
    })
    expect(accepted).toMatchObject({
      ok: true,
      citations: [{ ref: "r1:result:1" }],
    })
    expect(state.finalized).toBe(true)
    expect(state.finalizedManifest?.citations).toEqual([{ ref: "r1:result:1" }])
  })

  it("maps finalize picks across successive searches", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())
    const state: {
      finalizedManifest?: OutputManifest
    } = {}
    const tools = createHarnessTools({
      state,
      ledger,
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })
    await retainLatestSearch(tools, ledger)
    ledger.addRetrievalResponse({
      ...makeRetrievalResponse(),
      query: "second query",
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
    await retainLatestSearch(tools, ledger)

    const accepted = await executeTool(tools.finalize, {
      text: "Second source [[cite:1]].",
      citations: [{ pick: 2 }],
      memoryCitations: [],
      artifacts: [],
      unresolved: [],
    })

    expect(accepted).toMatchObject({
      ok: true,
      citations: [{ ref: "r2:result:1" }],
    })
    expect(state.finalizedManifest?.citations).toEqual([{ ref: "r2:result:1" }])
  })

  it("accepts free-form text with no citations, displayed artifacts, or unresolved gaps", async () => {
    const state: {
      finalizedManifest?: OutputManifest
      finalized?: boolean
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    const result = await executeTool(tools.finalize, {
      text: "Hi there! How can I help?",
      citations: [],
      memoryCitations: [],
      artifacts: [],
      unresolved: [],
    })

    expect(result).toMatchObject({ ok: true })
    expect(state.finalizedManifest?.text).toBe("Hi there! How can I help?")
    expect(state.finalized).toBe(true)
  })

  it("accepts explicitly unresolved output without planning-tool gating", async () => {
    const state: {
      finalizedManifest?: OutputManifest
      finalized?: boolean
      memoryItems?: MemorySearchItem[]
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    const manifest = {
      text: "Answer.",
      citations: [],
      memoryCitations: [],
      artifacts: [],
      unresolved: ["No source evidence is available."],
    }

    expect(await executeTool(tools.finalize, manifest)).toMatchObject({
      ok: true,
      text: "Answer.",
    })
    expect(state.finalizedManifest).toEqual(manifest)
    expect(state.finalized).toBe(true)
  })

  it("returns memory refs from memory_search and stores memoryCitations on finalize", async () => {
    const search = vi.fn<MemoryToolRuntime["search"]>().mockResolvedValue({
      query: "毛利率",
      items: [
        {
          ref: "mem:1",
          itemId: "item_1",
          kind: "stance",
          text: "关注毛利率下滑 用户把毛利率当作核心观察指标。",
        },
      ],
    })
    const state: {
      finalizedManifest?: OutputManifest
      finalized?: boolean
      memoryItems?: MemorySearchItem[]
    } = {}
    const tools = createHarnessTools({
      state,
      ledger: createEvidenceLedger(),
      memoryTools: makeMemoryTools(search),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    const searchText = await executeTool(tools.memory_search, {
      query: "毛利率",
    })
    const repeatedSearchText = await executeTool(tools.memory_search, {
      query: "盈利能力",
    })
    expect(searchText).toContain('<memory operation="search" status="ok">')
    expect(searchText).toContain('ref="mem:1"')
    expect(searchText).not.toContain("itemId")
    expect(repeatedSearchText).toContain('status="error"')
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenNthCalledWith(1, {
      query: "毛利率",
      kinds: undefined,
    })
    expect(state.memoryItems).toEqual([
      {
        ref: "mem:1",
        itemId: "item_1",
        kind: "stance",
        text: "关注毛利率下滑 用户把毛利率当作核心观察指标。",
      },
    ])

    const manifest = {
      text: "按已有记忆，毛利率是核心观察指标。",
      citations: [],
      memoryCitations: [{ ref: "mem:1" }],
      artifacts: [],
      unresolved: [],
    }
    const resolvedMemoryCitations = [
      { ref: "mem:1", itemId: "item_1", kind: "stance" as const },
    ]
    const invalidManifest = {
      ...manifest,
      memoryCitations: [{ ref: "mem:missing" }],
    }
    expect(await executeTool(tools.finalize, invalidManifest)).toMatchObject({
      ok: false,
      invalidMemoryCitations: invalidManifest.memoryCitations,
    })
    expect(state.finalizedManifest).toBeUndefined()

    expect(await executeTool(tools.finalize, manifest)).toMatchObject({
      ok: true,
      memoryCitations: resolvedMemoryCitations,
    })
    expect(state.finalizedManifest).toEqual({
      ...manifest,
      memoryCitations: resolvedMemoryCitations,
    })
  })

  it("returns a warning when memory_search cannot reach memory", async () => {
    const search = vi
      .fn<MemoryToolRuntime["search"]>()
      .mockRejectedValue(new Error("MEMENTO_BASE_URL is required."))
    const tools = createHarnessTools({
      state: {},
      ledger: createEvidenceLedger(),
      memoryTools: makeMemoryTools(search),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    const searchText = await executeTool(tools.memory_search, {
      query: "毛利率",
    })
    expect(searchText).toContain('<memory operation="search" status="warning">')
    expect(searchText).toContain("MEMENTO_BASE_URL is required.")
    expect(searchText).not.toContain('status="error"')
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
      memoryTools: makeMemoryTools(),
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
      memoryTools: makeMemoryTools(),
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

  it("keeps retrieval tools closed until declareIntent allows them", () => {
    const result = prepareHarnessStep({
      stepNumber: 11,
      messages: [
        {
          role: "user",
          content: "Find the penalty amount.",
        },
      ],
    })

    expect(result.activeTools).toEqual([
      "declareIntent",
      "setContextPolicy",
      "readPriorTurn",
    ])
    expect(result.activeTools).not.toContain("finalize")
    expect(result.activeTools).not.toContain("memory_search")
    expect(result.activeTools).not.toContain("knowhere_search")
  })

  it("opens only memory_search after intent says retrieval may be needed", () => {
    const result = prepareHarnessStep({
      stepNumber: 3,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "maybe",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "can_use_context",
      },
      messages: [],
    })

    expect(result.activeTools).toContain("memory_search")
    expect(result.activeTools).toContain("prepareAnswer")
    expect(result.activeTools).not.toContain("finalize")
    expect(result.activeTools).not.toContain("knowhere_search")
  })

  it("does not expose memory_search again after its one call", () => {
    const result = prepareHarnessStep({
      stepNumber: 4,
      hasMemorySearch: true,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "maybe",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "can_use_context",
      },
      messages: [],
    })

    expect(result.activeTools).not.toContain("memory_search")
  })

  it("keeps Knowhere tools closed for no_retrieval", () => {
    const result = prepareHarnessStep({
      stepNumber: 4,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "no",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "no_retrieval",
      },
      messages: [],
    })

    expect(result.activeTools).toContain("prepareAnswer")
    expect(result.activeTools).not.toContain("finalize")
    expect(result.activeTools).not.toContain("memory_search")
    expect(result.activeTools).not.toContain("knowhere_search")
  })

  it("forces a tool call on ordinary steps so the model cannot skip finalize with bare text", () => {
    const result = prepareHarnessStep({
      stepNumber: 3,
      messages: [],
    })

    expect(result.toolChoice).toBe("required")
    expect(result.activeTools).not.toContain("finalize")
  })

  it("blocks finalize on the first step so a document question cannot skip search", () => {
    const result = prepareHarnessStep({
      stepNumber: 1,
      messages: [
        {
          role: "user",
          content: "高血压合并冠心病，血压目标一般怎么定？",
        },
      ],
    })

    expect(result.activeTools).not.toContain("finalize")
    expect(result.toolChoice).toBe("required")
  })

  it("opens memory_search and knowhere_search together as peers when sources are required", () => {
    const result = prepareHarnessStep({
      stepNumber: 3,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "yes",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "must_use_sources",
      },
      messages: [],
    })

    expect(result.activeTools).toEqual(
      expect.arrayContaining(["memory_search", "knowhere_search"]),
    )
    expect(result.activeTools).not.toContain("finalize")
    expect(result.activeTools).not.toContain("knowhere_list_documents")
    expect(result.activeTools).not.toContain("knowhere_get_document_outline")
    expect(result.activeTools).not.toContain("knowhere_read_chunks")
    expect(result.activeTools).not.toContain("knowhere_grep_chunks")
  })

  it("opens answer preparation after must_use_sources has called knowhere_search", () => {
    const result = prepareHarnessStep({
      stepNumber: 4,
      hasKnowhereSearch: true,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "yes",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "must_use_sources",
      },
      messages: [],
    })

    expect(result.activeTools).toContain("prepareAnswer")
    expect(result.activeTools).not.toContain("finalize")
    expect(result.activeTools).not.toContain("knowhere_search")
  })

  it("forces answer preparation after the one Knowhere search", () => {
    const result = prepareHarnessStep({
      stepNumber: 8,
      hasKnowhereSearch: true,
      hasReachedKnowhereSearchLimit: true,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "yes",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "must_use_sources",
      },
      messages: [],
    })

    expect(result.activeTools).toEqual(["prepareAnswer"])
    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: "prepareAnswer",
    })
  })

  it("replaces retrieval history with the assembled context for finalization", () => {
    const answerContextMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "## User's Question\nQuestion" }],
    }
    const result = prepareHarnessStep({
      stepNumber: 5,
      messages: [{ role: "user", content: "retrieval history" }],
      answerContextMessage,
    })

    expect(result.messages).toEqual([answerContextMessage])
    expect(result.activeTools).toEqual(["finalize"])
    expect(result.toolChoice).toEqual({ type: "tool", toolName: "finalize" })
  })

  it("forces retainEvidence after a search returns new evidence", () => {
    const result = prepareHarnessStep({
      stepNumber: 4,
      hasPendingRetention: true,
      pendingRetentionRange: { startPick: 1, endPick: 3 },
      hasKnowhereSearch: true,
      intent: {
        task: "answer",
        dependsOnPreviousTurn: false,
        retrievalNeeded: "yes",
        targetModalities: ["text"],
        constraints: {},
        groundingPolicy: "must_use_sources",
      },
      messages: [],
    })

    expect(result.activeTools).toEqual(["retainEvidence"])
    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: "retainEvidence",
    })
    expect(result.messages).toEqual([
      {
        role: "user",
        content: expect.stringContaining("1-3"),
      },
    ])
    expect(result.activeTools).not.toContain("finalize")
    expect(result.activeTools).not.toContain("knowhere_search")
  })

  it("prepares the answer only after the latest search has been retained", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())
    const state: { answerContextRequested?: boolean } = {}
    const tools = createHarnessTools({
      state,
      ledger,
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    expect(await executeTool(tools.prepareAnswer, {})).toMatchObject({ ok: false })
    expect(state.answerContextRequested).not.toBe(true)

    await executeTool(tools.retainEvidence, { picks: [1] })
    expect(await executeTool(tools.prepareAnswer, {})).toEqual({ ok: true })
    expect(state.answerContextRequested).toBe(true)
  })

  it("rejects displayed artifacts whose evidence was not retained", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())
    const tools = createHarnessTools({
      state: {},
      ledger,
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })
    await executeTool(tools.retainEvidence, { picks: [] })

    const result = await executeTool(tools.finalize, {
      text: "See the chart.",
      citations: [],
      memoryCitations: [],
      artifacts: [
        {
          type: "image",
          ref: "asset:r1:result:1",
          display: true,
          reason: "Show the chart.",
        },
      ],
      unresolved: [],
    })
    expect(result).toMatchObject({
      ok: false,
      unretainedArtifactRefs: ["asset:r1:result:1"],
    })
  })

  it("rejects retainEvidence picks outside the latest search", async () => {
    const ledger = createEvidenceLedger()
    ledger.addRetrievalResponse(makeRetrievalResponse())
    const tools = createHarnessTools({
      state: {},
      ledger,
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })

    const rejected = await executeTool(tools.retainEvidence, { picks: [2] })
    expect(rejected).toMatchObject({
      ok: false,
      invalidPicks: [2],
    })
    expect(ledger.hasPendingRetention()).toBe(true)

    const accepted = await executeTool(tools.retainEvidence, { picks: [] })
    expect(accepted).toMatchObject({ ok: true, retainedPicks: [] })
    expect(ledger.hasPendingRetention()).toBe(false)
    expect(ledger.isRetained(1)).toBe(false)
  })

  it("rejects finalize of unretained first-search picks after a later search", async () => {
    const ledger = createEvidenceLedger()
    const tools = createHarnessTools({
      state: {},
      ledger,
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(),
      recentTurns: [],
    })
    ledger.addRetrievalResponse(makeRetrievalResponse())
    await executeTool(tools.retainEvidence, { picks: [] })
    ledger.addRetrievalResponse({
      ...makeRetrievalResponse(),
      query: "second query",
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
    await executeTool(tools.retainEvidence, { picks: [2] })

    const rejected = await executeTool(tools.finalize, {
      text: "First source [[cite:1]].",
      citations: [{ pick: 1 }],
      memoryCitations: [],
      artifacts: [],
      unresolved: [],
    })
    expect(rejected).toMatchObject({
      ok: false,
      unretainedPicks: [1],
    })
    expect(String((rejected as { message: string }).message)).toContain(
      "Unretained citation picks",
    )
    expect(String((rejected as { message: string }).message)).not.toContain(
      "Unknown citation picks",
    )

    const accepted = await executeTool(tools.finalize, {
      text: "Second source [[cite:1]].",
      citations: [{ pick: 2 }],
      memoryCitations: [],
      artifacts: [],
      unresolved: [],
    })
    expect(accepted).toMatchObject({
      ok: true,
      citations: [{ ref: "r2:result:1" }],
    })
  })

  it("allows one knowhere_search and rejects a second call", async () => {
    const search = vi
      .fn<KnowhereToolRuntime["search"]>()
      .mockResolvedValue(makeRetrievalResponse())
    const tools = createHarnessTools({
      state: {},
      ledger: createEvidenceLedger(),
      memoryTools: makeMemoryTools(),
      knowhereTools: makeKnowhereTools(search),
      recentTurns: [],
    })

    const first = await executeTool(tools.knowhere_search, { query: "first" })
    expect(first).toContain('status="ok"')
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "first" }),
    )
    expect(search.mock.calls[0]?.[0]).not.toHaveProperty("gapReason")

    const rejected = await executeTool(tools.knowhere_search, { query: "second" })
    expect(rejected).toContain('status="error"')
    expect(String(rejected)).toContain("already ran for this turn")
    expect(search).toHaveBeenCalledTimes(1)
  })

})

function retainLatestSearch(
  tools: { retainEvidence: unknown },
  ledger: ReturnType<typeof createEvidenceLedger>,
): Promise<unknown> {
  const pending = ledger.pendingRetentionRange()
  if (!pending) return Promise.resolve(undefined)
  const picks: number[] = []
  for (let pick = pending.startPick; pick <= pending.endPick; pick += 1) {
    picks.push(pick)
  }
  return executeTool(tools.retainEvidence, { picks })
}

function executeTool(tool: unknown, input: unknown): Promise<unknown> {
  return (tool as { execute: (input: unknown) => Promise<unknown> }).execute(input)
}

function makeMemoryTools(
  search: MemoryToolRuntime["search"] = vi
    .fn()
    .mockResolvedValue({ query: "", items: [] }),
): MemoryToolRuntime {
  return { search }
}

function makeKnowhereTools(
  search: KnowhereToolRuntime["search"] = vi.fn(),
): KnowhereToolRuntime {
  return {
    search,
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

function makeConnectedRetrievalResponse(): RetrievalQueryResponse {
  return {
    namespace: "notebook",
    query: "comparison",
    routerUsed: "agent_explore",
    answerText: null,
    evidenceText: "Comparison evidence",
    stopReason: "answer_done",
    failureReason: null,
    results: [
      {
        chunkId: "text_chunk",
        content: "Comparison [tables/comparison.html]",
        chunkType: "text",
        score: 0.9,
        metadata: {
          connectTo: [
            {
              target: "table_chunk",
              relation: "embeds",
              ref: "[tables/comparison.html]",
            },
            {
              target: "image_chunk",
              relation: "embeds",
              ref: "[images/comparison.jpg]",
            },
          ],
        },
        source: {
          documentId: "doc_1",
          sourceFileName: "cardiology.pdf",
          sectionPath: "Differential diagnosis",
        },
      },
    ],
    referencedChunks: [],
  }
}

function toolCallResult(
  calls: readonly {
    toolCallId: string
    toolName: string
    input: unknown
  }[],
) {
  return {
    content: calls.map((call) => ({
      type: "tool-call" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    })),
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
    },
    warnings: [],
  }
}
