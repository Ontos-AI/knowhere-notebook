import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { generateText } from "ai"

import {
  answerQuestionWithRetrieval,
  buildGroundedPrompt,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "./chat"
import type { Source } from "./schema"

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

afterEach(() => {
  vi.mocked(generateText).mockReset();
  delete process.env.AI_GATEWAY_API_KEY;
});

describe("answerQuestionWithRetrieval", () => {
  it("queries the workspace namespace and excludes unchecked ready documents", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
      }),
    };
    const generateAnswer = vi.fn().mockResolvedValue("The answer is grounded.");

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the document say?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({ knowhereDocumentId: "doc_included" }),
          makeSource({ id: "source_2", knowhereDocumentId: "doc_excluded" }),
        ],
        excludedSourceIds: ["source_2"],
        retrieval,
        generateAnswer,
      }),
    );

    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "What does the document say?",
      topK: 8,
      excludeDocumentIds: ["doc_excluded"],
    });
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What does the document say?",
      results: [makeRetrievalResult()],
    });
    expect(answer).toEqual({
      answer: "The answer is grounded.",
      citations: [makeRetrievalResult()],
    });
  });

  it("returns a deterministic no-results answer without calling the model", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({ results: [] }),
    };
    const generateAnswer = vi.fn();

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Missing fact?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
      }),
    );

    expect(generateAnswer).not.toHaveBeenCalled();
    expect(answer).toEqual({
      answer: "I couldn't find that in your sources.",
      citations: [],
    });
  });
});

describe("generateGroundedAnswer", () => {
  it("routes grounded prompts through Vercel AI Gateway model strings", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    vi.mocked(generateText).mockResolvedValue({
      text: "PR-E wires chat to retrieval.",
    } as Awaited<ReturnType<typeof generateText>>);

    const answer = await generateGroundedAnswer({
      question: "What is PR-E?",
      results: [
        makeRetrievalResult({
          content: "PR-E wires chat to Knowhere retrieval.",
        }),
      ],
    });

    expect(generateText).toHaveBeenCalledWith({
      model: "deepseek/deepseek-v4-flash",
      prompt: expect.stringContaining("PR-E wires chat to Knowhere retrieval."),
    });
    expect(answer).toBe("PR-E wires chat to retrieval.");
  });
});

describe("buildGroundedPrompt", () => {
  it("includes retrieved source content and forbids unsupported answers", () => {
    const prompt = buildGroundedPrompt({
      question: "What is PR-E?",
      results: [
        makeRetrievalResult({
          content: "PR-E wires chat to Knowhere retrieval.",
          source: {
            documentId: "doc_1",
            sourceFileName: "requirements.txt",
            sectionPath: "N-005",
          },
        }),
      ],
    });

    expect(prompt).toContain("What is PR-E?");
    expect(prompt).toContain("PR-E wires chat to Knowhere retrieval.");
    expect(prompt).toContain("requirements.txt");
    expect(prompt).toContain("If the sources do not answer");
  });
});

describe("parseChatRequestBody", () => {
  it("accepts a trimmed message, optional thread id, and string source exclusions", () => {
    expect(
      parseChatRequestBody({
        message: "  What changed?  ",
        threadId: "thread_1",
        excludedSourceIds: ["source_1", 7, "source_2"],
      }),
    ).toEqual({
      ok: true,
      value: {
        question: "What changed?",
        threadId: "thread_1",
        excludedSourceIds: ["source_1", "source_2"],
      },
    });
  });

  it("rejects empty questions before retrieval or model calls", () => {
    expect(parseChatRequestBody({ message: "   " })).toEqual({
      ok: false,
      message: "Enter a question before sending.",
      status: 400,
    });
  });
});

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
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}
