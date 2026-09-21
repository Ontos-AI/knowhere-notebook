import { Either } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  handleChatTurn: vi.fn(),
  captureMemoryTurn: vi.fn(),
  recordActivations: vi.fn(),
}))

vi.mock("./service", () => ({
  handleChatTurn: mocks.handleChatTurn,
}))

vi.mock("@/integrations/memento/client", () => ({
  captureMemoryTurn: mocks.captureMemoryTurn,
  recordActivations: mocks.recordActivations,
}))

import { commitChatTurn } from "./commit-turn"
import type { Workspace } from "@/infrastructure/db/schema"

describe("commitChatTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recordActivations.mockResolvedValue(undefined)
    mocks.captureMemoryTurn.mockResolvedValue(undefined)
  })

  it("records fluid memory activations from finalize after a successful turn", async () => {
    mocks.handleChatTurn.mockImplementation(async (input) => {
      await input.generateAnswer({
        question: "毛利率",
        messages: [],
        sources: [],
        excludedSourceIds: [],
        searchSources: vi.fn(),
      })
      return Either.right({
        threadId: "thread_1",
        messages: [
          { id: "msg_user", role: "user", content: "毛利率" },
          {
            id: "msg_assistant",
            role: "assistant",
            content: "按已有记忆。",
            citations: [
              {
                chunkId: "chunk_1",
                chunkType: "text",
                score: 0.9,
                source: { documentId: "doc_1" },
              },
            ],
          },
        ],
      })
    })

    const generateAnswer = vi.fn(async () => ({
      manifest: {
        text: "按已有记忆。",
        citations: [],
        memoryCitations: [
          { ref: "mem:1", itemId: "item_1", kind: "stance" as const },
        ],
        artifacts: [],
        unresolved: [],
      },
      trace: {
        ledger: {
          retrievalCount: 0,
          chunks: [],
          assets: [],
          evidence: [],
          evidenceText: [],
          stopReasons: [],
          failureReasons: [],
          decisionTraces: [],
        },
        finalized: true,
        priorTurnReads: [],
        toolCalls: [],
        imageHighlights: [],
        validationErrors: [],
        revisionsUsed: 0,
      },
    }))

    const result = await commitChatTurn({
      workspace: makeWorkspace(),
      sources: [],
      question: "毛利率",
      excludedSourceIds: [],
      retrieval: { query: vi.fn() },
      generateAnswer,
      repository: {
        ensureDefaultChatThread: vi.fn(),
        findChatThreadInWorkspace: vi.fn(),
        listMessagesForThread: vi.fn().mockResolvedValue([
          {
            id: "msg_old_user",
            threadId: "thread_1",
            role: "user",
            content: "上次问毛利率",
            citations: null,
            artifacts: null,
            agentTrace: null,
            createdAt: new Date("2026-09-20T00:00:00Z"),
          },
          {
            id: "msg_old_assistant",
            threadId: "thread_1",
            role: "assistant",
            content: "按文档算。",
            citations: null,
            artifacts: null,
            agentTrace: {
              intentTask: "answer",
              toolCalls: [
                { tool: "knowhere_search", ok: true, summary: '{"input":{"query":"毛利率"}}' },
              ],
              referencedDocumentIds: ["doc_1"],
            },
            createdAt: new Date("2026-09-20T00:00:01Z"),
          },
          {
            id: "msg_user",
            threadId: "thread_1",
            role: "user",
            content: "毛利率",
            citations: null,
            artifacts: null,
            agentTrace: null,
            createdAt: new Date("2026-09-20T00:01:00Z"),
          },
          {
            id: "msg_assistant",
            threadId: "thread_1",
            role: "assistant",
            content: "按已有记忆。",
            citations: null,
            artifacts: null,
            agentTrace: {
              intentTask: "answer",
              toolCalls: [
                { tool: "knowhere_search", ok: true, summary: '{"input":{"query":"当轮"}}' },
              ],
              referencedDocumentIds: ["doc_1"],
            },
            createdAt: new Date("2026-09-20T00:01:01Z"),
          },
        ]),
        appendMessageToThread: vi.fn(),
      },
    })

    expect(Either.isRight(result)).toBe(true)
    expect(mocks.captureMemoryTurn).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sessionId: "thread_1",
      turns: [
        {
          userText: "毛利率",
          assistantText: "按已有记忆。",
          sourceMessageId: "msg_assistant",
          referencedDocumentIds: ["doc_1"],
          agentTrace: {
            intentTask: "answer",
            toolCalls: [
              { tool: "knowhere_search", ok: true, summary: '{"input":{"query":"当轮"}}' },
            ],
            referencedDocumentIds: ["doc_1"],
          },
          recentContext: [
            {
              userText: "上次问毛利率",
              assistantText: "按文档算。",
              agentTrace: {
                intentTask: "answer",
                toolCalls: [
                  {
                    tool: "knowhere_search",
                    ok: true,
                    summary: '{"input":{"query":"毛利率"}}',
                  },
                ],
                referencedDocumentIds: ["doc_1"],
              },
            },
          ],
        },
      ],
    })
    expect(mocks.recordActivations).toHaveBeenCalledWith([
      {
        workspaceId: "workspace_1",
        unitType: "crystal_chunk",
        unitRef: "doc_1:chunk_1",
      },
    ])
    expect(mocks.recordActivations).toHaveBeenCalledWith([
      {
        workspaceId: "workspace_1",
        unitType: "fluid_memory",
        unitRef: "item_1",
      },
    ])
  })
})

function makeWorkspace(): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
    namespace: "notebook-namespace",
    createdAt: new Date("2026-09-10T00:00:00Z"),
  }
}
