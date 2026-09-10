import { Either } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  handleChatTurn: vi.fn(),
  triggerMemoryExtraction: vi.fn(),
  recordActivations: vi.fn(),
}))

vi.mock("./service", () => ({
  handleChatTurn: mocks.handleChatTurn,
}))

vi.mock("@/domains/memory/extract-trigger", () => ({
  triggerMemoryExtraction: mocks.triggerMemoryExtraction,
}))

vi.mock("@/domains/retrieval-activation/service", () => ({
  retrievalActivationService: {
    recordActivations: mocks.recordActivations,
  },
}))

import { commitChatTurn } from "./commit-turn"
import type { Workspace } from "@/infrastructure/db/schema"

describe("commitChatTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recordActivations.mockResolvedValue(1)
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
        listMessagesForThread: vi.fn(),
        appendMessageToThread: vi.fn(),
      },
    })

    expect(Either.isRight(result)).toBe(true)
    expect(mocks.triggerMemoryExtraction).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      threadId: "thread_1",
      userMessageId: "msg_user",
      assistantMessageId: "msg_assistant",
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
