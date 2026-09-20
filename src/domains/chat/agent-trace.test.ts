import { describe, expect, it } from "vitest"

import type { HarnessTrace } from "@/agent-harness"

import {
  toChatAgentTrace,
  toRecentCaptureContext,
} from "./agent-trace"

describe("toChatAgentTrace", () => {
  it("keeps the outer Notebook TRACE and drops the Knowhere TRACE", () => {
    const trace = toChatAgentTrace(makeTrace())

    expect(trace).toEqual({
      intentTask: "answer",
      toolCalls: [
        {
          tool: "knowhere_search",
          ok: true,
          summary: JSON.stringify({
            input: { query: "毛利率" },
            output: { ok: true, chunkCount: 2 },
          }),
        },
      ],
      referencedDocumentIds: ["doc_1"],
    })
    expect(JSON.stringify(trace)).not.toContain("decisionTraces")
    expect(JSON.stringify(trace)).not.toContain("agent_explore")
  })

  it("keeps the full tool summary", () => {
    const inputSummary = { query: "x".repeat(300) }
    const outputSummary = { text: "y".repeat(300) }
    const trace = toChatAgentTrace(
      makeTrace({
        toolCalls: [
          {
            tool: "knowhere_search",
            ok: true,
            inputSummary,
            outputSummary,
            startedAt: "2026-09-20T00:00:00.000Z",
            durationMs: 12,
          },
        ],
      }),
    )

    expect(trace.toolCalls[0]?.summary).toBe(
      JSON.stringify({ input: inputSummary, output: outputSummary }),
    )
  })
})

describe("toRecentCaptureContext", () => {
  it("takes the last five prior turns and skips the current turn", () => {
    const messages = [
      makeMessage("u1", "user", "q1"),
      makeMessage("a1", "assistant", "a1", {
        intentTask: "answer",
        toolCalls: [],
        referencedDocumentIds: ["doc_old"],
      }),
      makeMessage("u2", "user", "q2"),
      makeMessage("a2", "assistant", "a2"),
      makeMessage("u3", "user", "q3"),
      makeMessage("a3", "assistant", "a3"),
      makeMessage("u4", "user", "q4"),
      makeMessage("a4", "assistant", "a4"),
      makeMessage("u5", "user", "q5"),
      makeMessage("a5", "assistant", "a5"),
      makeMessage("u6", "user", "q6"),
      makeMessage("a6", "assistant", "a6"),
      makeMessage("u7", "user", "current question"),
      makeMessage("a7", "assistant", "current answer"),
    ]

    expect(toRecentCaptureContext(messages, ["u7", "a7"])).toEqual([
      { userText: "q2", assistantText: "a2" },
      { userText: "q3", assistantText: "a3" },
      { userText: "q4", assistantText: "a4" },
      { userText: "q5", assistantText: "a5" },
      { userText: "q6", assistantText: "a6" },
    ])
  })
})

function makeTrace(overrides: Partial<HarnessTrace> = {}): HarnessTrace {
  return {
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
    ledger: {
      retrievalCount: 1,
      chunks: [
        {
          ref: "r1:result:1",
          kind: "result",
          content: "Revenue rose.",
          contentPreview: "Revenue rose.",
          chunkType: "text",
          score: 0.9,
          source: { documentId: "doc_1" },
        },
      ],
      assets: [],
      evidenceText: [],
      stopReasons: [],
      failureReasons: [],
      decisionTraces: [
        [{ agent: "agent_explore", phase: "tool_call", observation: "inner" }],
      ],
      retainedPicks: [1],
      pendingRetention: null,
    },
    finalized: true,
    priorTurnReads: [],
    toolCalls: [
      {
        tool: "knowhere_search",
        ok: true,
        inputSummary: { query: "毛利率" },
        outputSummary: { ok: true, chunkCount: 2 },
        startedAt: "2026-09-20T00:00:00.000Z",
        durationMs: 12,
      },
    ],
    imageHighlights: [],
    validationErrors: [],
    revisionsUsed: 0,
    ...overrides,
  }
}

function makeMessage(
  id: string,
  role: "user" | "assistant",
  content: string,
  agentTrace?: {
    intentTask: string
    toolCalls: readonly { tool: string; ok: boolean; summary: string }[]
    referencedDocumentIds: readonly string[]
  },
) {
  return { id, role, content, agentTrace }
}
