import { Either } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  handleChatTurn: vi.fn(),
  captureMemoryTurn: vi.fn(),
  reportRetrieval: vi.fn(),
}))

vi.mock("./service", () => ({
  handleChatTurn: mocks.handleChatTurn,
}))

vi.mock("@/integrations/memento/client", () => ({
  captureMemoryTurn: mocks.captureMemoryTurn,
  reportRetrieval: mocks.reportRetrieval,
  listActivations: vi.fn().mockResolvedValue([]),
  getWorkspaceProfile: vi.fn().mockResolvedValue(null),
  searchRelevantAgentFeedback: vi.fn().mockResolvedValue([]),
}))

import { commitChatTurn } from "./commit-turn"
import type { Workspace } from "@/infrastructure/db/schema"

describe("commitChatTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reportRetrieval.mockResolvedValue(undefined)
    mocks.captureMemoryTurn.mockResolvedValue(undefined)
  })

  it("reports retrieved chunks and memory plus the cited subset", async () => {
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
        citations: [{ ref: "r1:result:1" }],
        memoryCitations: [
          { ref: "mem:1", itemId: "item_1", kind: "stance" as const },
        ],
        artifacts: [],
        unresolved: [],
      },
      memoryItems: [
        {
          ref: "mem:1",
          itemId: "item_1",
          kind: "stance" as const,
          text: "cited memory",
        },
        {
          ref: "mem:2",
          itemId: "item_2",
          kind: "event" as const,
          text: "unused memory",
        },
      ],
      trace: {
        ledger: {
          retrievalCount: 1,
          chunks: [
            {
              ref: "r1:result:1",
              kind: "result" as const,
              chunkId: "chunk_1",
              content: "cited",
              contentPreview: "cited",
              chunkType: "text",
              score: 0.9,
              source: { documentId: "doc_1" },
            },
            {
              ref: "r1:result:2",
              kind: "result" as const,
              chunkId: "chunk_2",
              content: "unused",
              contentPreview: "unused",
              chunkType: "text",
              score: 0.4,
              source: { documentId: "doc_1" },
            },
          ],
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
    expect(mocks.reportRetrieval).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      retrieved: [
        { unitType: "crystal_chunk", unitRef: "doc_1:chunk_1" },
        { unitType: "crystal_chunk", unitRef: "doc_1:chunk_2" },
        { unitType: "fluid_memory", unitRef: "item_1" },
        { unitType: "fluid_memory", unitRef: "item_2" },
      ],
      cited: [
        { unitType: "crystal_chunk", unitRef: "doc_1:chunk_1" },
        { unitType: "fluid_memory", unitRef: "item_1" },
      ],
    })
  })

  it("reports the retrieved set when nothing was written into the answer", async () => {
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
            content: "没有用到检索结果。",
            citations: [],
          },
        ],
      })
    })

    const generateAnswer = vi.fn(async () => ({
      manifest: {
        text: "没有用到检索结果。",
        citations: [],
        memoryCitations: [],
        artifacts: [],
        unresolved: [],
      },
      memoryItems: [
        {
          ref: "mem:1",
          itemId: "item_1",
          kind: "stance" as const,
          text: "unused memory",
        },
      ],
      trace: {
        ledger: {
          retrievalCount: 1,
          chunks: [
            {
              ref: "r1:result:1",
              kind: "result" as const,
              chunkId: "chunk_1",
              content: "unused",
              contentPreview: "unused",
              chunkType: "text",
              score: 0.4,
              source: { documentId: "doc_1" },
            },
          ],
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
        listMessagesForThread: vi.fn().mockResolvedValue([]),
        appendMessageToThread: vi.fn(),
      },
    })

    expect(Either.isRight(result)).toBe(true)
    expect(mocks.reportRetrieval).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      retrieved: [
        { unitType: "crystal_chunk", unitRef: "doc_1:chunk_1" },
        { unitType: "fluid_memory", unitRef: "item_1" },
      ],
      cited: [],
    })
  })

  it("reports an empty retrieved set when search ran and found nothing", async () => {
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
          { id: "msg_assistant", role: "assistant", content: "没有相关记忆。", citations: [] },
        ],
      })
    })

    const result = await commitChatTurn({
      workspace: makeWorkspace(),
      sources: [],
      question: "毛利率",
      excludedSourceIds: [],
      retrieval: { query: vi.fn() },
      generateAnswer: vi.fn(async () => ({
        manifest: {
          text: "没有相关记忆。",
          citations: [],
          memoryCitations: [],
          artifacts: [],
          unresolved: [],
        },
        memoryItems: [],
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
          toolCalls: [
            {
              tool: "memory_search",
              ok: true,
              inputSummary: {},
              outputSummary: {},
              startedAt: "2026-09-21T00:00:00.000Z",
              durationMs: 1,
            },
          ],
          imageHighlights: [],
          validationErrors: [],
          revisionsUsed: 0,
        },
      })),
      repository: {
        ensureDefaultChatThread: vi.fn(),
        findChatThreadInWorkspace: vi.fn(),
        listMessagesForThread: vi.fn().mockResolvedValue([]),
        appendMessageToThread: vi.fn(),
      },
    })

    expect(Either.isRight(result)).toBe(true)
    expect(mocks.reportRetrieval).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      retrieved: [],
      cited: [],
    })
  })

  it("does not report when the turn did not retrieve", async () => {
    mocks.handleChatTurn.mockImplementation(async (input) => {
      await input.generateAnswer({
        question: "你好",
        messages: [],
        sources: [],
        excludedSourceIds: [],
        searchSources: vi.fn(),
      })
      return Either.right({
        threadId: "thread_1",
        messages: [
          { id: "msg_user", role: "user", content: "你好" },
          { id: "msg_assistant", role: "assistant", content: "你好。", citations: [] },
        ],
      })
    })

    const result = await commitChatTurn({
      workspace: makeWorkspace(),
      sources: [],
      question: "你好",
      excludedSourceIds: [],
      retrieval: { query: vi.fn() },
      generateAnswer: vi.fn(async () => ({
        manifest: {
          text: "你好。",
          citations: [],
          memoryCitations: [],
          artifacts: [],
          unresolved: [],
        },
        memoryItems: [],
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
      })),
      repository: {
        ensureDefaultChatThread: vi.fn(),
        findChatThreadInWorkspace: vi.fn(),
        listMessagesForThread: vi.fn().mockResolvedValue([]),
        appendMessageToThread: vi.fn(),
      },
    })

    expect(Either.isRight(result)).toBe(true)
    expect(mocks.reportRetrieval).not.toHaveBeenCalled()
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
