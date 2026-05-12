import { describe, expect, it, vi } from "vitest";
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk";
import { Either } from "effect";

import { handleChatTurn } from "./service";
import type { ChatMessage, ChatThread, Source, Workspace } from "@/infrastructure/db/schema";

describe("handleChatTurn", () => {
  it("creates a default thread, persists both turns, and returns UI messages", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
      }),
    };
    const repository = makeRepository();
    const generateRetrievalQuery = vi
      .fn()
      .mockResolvedValue("What does the document say?");
    const generateAnswer = vi.fn().mockResolvedValue("Grounded answer.");

    const result = await handleChatTurn({
      workspace: makeWorkspace(),
      sources: [
        makeSource({ id: "source_included", knowhereDocumentId: "doc_included" }),
        makeSource({ id: "source_excluded", knowhereDocumentId: "doc_excluded" }),
      ],
      question: "What does the document say?",
      excludedSourceIds: ["source_excluded"],
      retrieval,
      generateRetrievalQuery,
      generateAnswer,
      repository,
    });

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toMatchObject({
        threadId: "thread_1",
        messages: [
          { role: "user", content: "What does the document say?" },
          {
            role: "assistant",
            content: "Grounded answer.",
            citations: [makeRetrievalResult()],
          },
        ],
      });
    }
    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-namespace",
      query: "What does the document say?",
      topK: 8,
      excludeDocumentIds: ["doc_excluded"],
    });
    expect(generateRetrievalQuery).toHaveBeenCalledWith({
      question: "What does the document say?",
      messages: [],
      sources: [
        makeSource({ id: "source_included", knowhereDocumentId: "doc_included" }),
        makeSource({ id: "source_excluded", knowhereDocumentId: "doc_excluded" }),
      ],
      excludedSourceIds: ["source_excluded"],
    });
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What does the document say?",
      retrievalQuery: "What does the document say?",
      messages: [],
      results: [makeRetrievalResult()],
    });
    expect(repository.appendMessageToThread).toHaveBeenNthCalledWith(1, "workspace_1", {
      threadId: "thread_1",
      role: "user",
      content: "What does the document say?",
    });
    expect(repository.appendMessageToThread).toHaveBeenNthCalledWith(2, "workspace_1", {
      threadId: "thread_1",
      role: "assistant",
      content: "Grounded answer.",
      citations: [makeRetrievalResult()],
    });
  });

  it("rejects chat before any source is ready without calling retrieval", async () => {
    const retrieval = { query: vi.fn() };
    const repository = makeRepository();

    const result = await handleChatTurn({
      workspace: makeWorkspace(),
      sources: [makeSource({ status: "parsing", knowhereDocumentId: null })],
      question: "Can I ask yet?",
      excludedSourceIds: [],
      retrieval,
      generateRetrievalQuery: vi.fn(),
      generateAnswer: vi.fn(),
      repository,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({
        status: 409,
        message: "Upload and process a document before asking questions.",
      });
    }
    expect(retrieval.query).not.toHaveBeenCalled();
    expect(repository.appendMessageToThread).not.toHaveBeenCalled();
  });

  it("rejects a thread id outside the workspace", async () => {
    const repository = makeRepository({
      findChatThreadInWorkspace: vi.fn().mockResolvedValue(null),
    });

    const result = await handleChatTurn({
      workspace: makeWorkspace(),
      sources: [makeSource()],
      question: "Private?",
      threadId: "thread_from_other_workspace",
      excludedSourceIds: [],
      retrieval: { query: vi.fn() },
      generateRetrievalQuery: vi.fn(),
      generateAnswer: vi.fn(),
      repository,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({
        status: 404,
        message: "Chat thread not found.",
      });
    }
    expect(repository.appendMessageToThread).not.toHaveBeenCalled();
  });

  it("passes prior thread messages to the stateless retrieval query planner", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
      }),
    };
    const previousMessages = [
      makeMessage({
        role: "user",
        content: "Tell me about the Tesla Q4 2025 Update.",
      }),
      makeMessage({
        role: "assistant",
        content: "It covers Tesla's Q4 financial summary.",
        citations: [
          {
            chunkType: "text",
            score: 0.9,
            source: {
              documentId: "doc_included",
              sourceFileName: "TSLA-Q4-2025-Update.pdf",
              sectionPath: "FINANCIAL SUMMARY",
            },
          },
        ],
      }),
    ];
    const repository = makeRepository({
      listMessagesForThread: vi.fn().mockResolvedValue(previousMessages),
    });
    const generateRetrievalQuery = vi
      .fn()
      .mockResolvedValue(
        "Tesla Q4 2025 Update energy generation and storage deployments",
      );
    const generateAnswer = vi.fn().mockResolvedValue("Grounded answer.");

    const result = await handleChatTurn({
      workspace: makeWorkspace(),
      sources: [makeSource({ title: "TSLA-Q4-2025-Update.pdf" })],
      question: "What about energy storage in this document?",
      threadId: "thread_1",
      excludedSourceIds: [],
      retrieval,
      generateRetrievalQuery,
      generateAnswer,
      repository,
    });

    expect(Either.isRight(result)).toBe(true);
    expect(generateRetrievalQuery).toHaveBeenCalledWith({
      question: "What about energy storage in this document?",
      messages: [
        {
          role: "user",
          content: "Tell me about the Tesla Q4 2025 Update.",
          citations: undefined,
        },
        {
          role: "assistant",
          content: "It covers Tesla's Q4 financial summary.",
          citations: [
            {
              chunkType: "text",
              score: 0.9,
              source: {
                documentId: "doc_included",
                sourceFileName: "TSLA-Q4-2025-Update.pdf",
                sectionPath: "FINANCIAL SUMMARY",
              },
            },
          ],
        },
      ],
      sources: [makeSource({ title: "TSLA-Q4-2025-Update.pdf" })],
      excludedSourceIds: [],
    });
    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-namespace",
      query: "Tesla Q4 2025 Update energy generation and storage deployments",
      topK: 8,
    });
  });
});

function makeRepository(
  overrides: Partial<ReturnType<typeof makeRepositoryShape>> = {},
): ReturnType<typeof makeRepositoryShape> {
  const shape = makeRepositoryShape();
  return { ...shape, ...overrides };
}

function makeRepositoryShape() {
  return {
    ensureDefaultChatThread: vi.fn().mockResolvedValue(makeThread()),
    findChatThreadInWorkspace: vi.fn().mockResolvedValue(makeThread()),
    listMessagesForThread: vi.fn().mockResolvedValue([]),
    appendMessageToThread: vi
      .fn()
      .mockImplementation(async (_workspaceId, input) =>
        makeMessage({
          role: input.role,
          content: input.content,
          citations: input.citations ?? null,
        }),
      ),
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace_1",
    userId: "user_1",
    namespace: "notebook-namespace",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    ...overrides,
  };
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_123",
    knowhereDocumentId: "doc_included",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread_1",
    workspaceId: "workspace_1",
    title: null,
    demoKey: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `message_${overrides.role ?? "user"}`,
    threadId: "thread_1",
    role: overrides.role ?? "user",
    content: overrides.content ?? "message",
    citations: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    ...overrides,
  };
}

function makeRetrievalResult(
  overrides: Partial<RetrievalResult> = {},
): RetrievalResult {
  return {
    content: "Grounding content",
    chunkType: "text",
    score: 0.9,
    source: {
      documentId: "doc_included",
      sourceFileName: "notes.txt",
      sectionPath: "Intro",
    },
    ...overrides,
  };
}
