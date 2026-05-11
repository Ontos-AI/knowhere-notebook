import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { generateText } from "ai"

import {
  answerQuestionWithRetrieval,
  buildGroundedPrompt,
  buildRetrievalQueryPrompt,
  generateContextualRetrievalQuery,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "."
import type { Source } from "@/infrastructure/db/schema"

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
    const generateRetrievalQuery = vi
      .fn()
      .mockResolvedValue("What does the document say?");

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
        generateRetrievalQuery,
        generateAnswer,
        messages: [],
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
      retrievalQuery: "What does the document say?",
      messages: [],
      results: [makeRetrievalResult()],
    });
    expect(answer).toEqual({
      answer: "The answer is grounded.",
      citations: [makeRetrievalResult()],
    });
  });

  it("attaches citation descriptions from generated source labels", async () => {
    const firstResult = makeRetrievalResult({
      source: {
        documentId: "doc_1",
        sourceFileName: "notes.txt",
        sectionPath: "Revenue",
      },
    });
    const secondResult = makeRetrievalResult({
      content: "Gross margin improved.",
      source: {
        documentId: "doc_2",
        sourceFileName: "notes.txt",
        sectionPath: "Margin",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [firstResult, secondResult],
      }),
    };
    const generateAnswer = vi
      .fn()
      .mockResolvedValue(
        "Revenue improved [Source 1: revenue growth]. Margins expanded [Source 2: margin expansion].",
      );
    const generateRetrievalQuery = vi.fn().mockResolvedValue("What improved?");

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What improved?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateRetrievalQuery,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.citations).toEqual([
      { ...firstResult, description: "revenue growth" },
      { ...secondResult, description: "margin expansion" },
    ]);
  });

  it("uses Notebook source titles instead of generated Knowhere filenames", async () => {
    const result = makeRetrievalResult({
      source: {
        documentId: "doc_tesla",
        sourceFileName: "document-CFxAaNTRUliEnWOokpI66xfj7JJkad.pdf",
        sectionPath: "Root",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({ results: [result] }),
    };
    const generateAnswer = vi
      .fn()
      .mockResolvedValue("Tesla invested in xAI [Source 1: xAI investment].");
    const generateRetrievalQuery = vi.fn().mockResolvedValue("Tesla xAI investment");

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the document say about xAI?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            title: "TSLA-Q4-2025-Update.pdf",
            knowhereDocumentId: "doc_tesla",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateRetrievalQuery,
        generateAnswer,
        messages: [],
      }),
    );

    const expectedResult = {
      ...result,
      source: {
        ...result.source,
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
      },
    };
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What does the document say about xAI?",
      retrievalQuery: "Tesla xAI investment",
      messages: [],
      results: [expectedResult],
    });
    expect(answer.citations).toEqual([
      { ...expectedResult, description: "xAI investment" },
    ]);
  });

  it("returns a deterministic no-results answer without calling the model", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({ results: [] }),
    };
    const generateAnswer = vi.fn();
    const generateRetrievalQuery = vi.fn().mockResolvedValue("Missing fact?");

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Missing fact?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateRetrievalQuery,
        generateAnswer,
        messages: [],
      }),
    );

    expect(generateAnswer).not.toHaveBeenCalled();
    expect(answer).toEqual({
      answer: "I couldn't find that in your sources.",
      citations: [],
    });
  });

  it("uses an LLM-contextualized query while answering the user's original question", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
      }),
    };
    const generateRetrievalQuery = vi
      .fn()
      .mockResolvedValue(
        "Tesla Q4 2025 Update energy generation and storage deployments",
      );
    const generateAnswer = vi.fn().mockResolvedValue("Energy storage grew.");
    const messages = [
      {
        role: "user" as const,
        content: "Tell me about the Tesla Q4 2025 Update.",
      },
      {
        role: "assistant" as const,
        content: "It summarizes Tesla's Q4 2025 financials.",
      },
    ];

    await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What about energy storage in this document?",
        namespace: "notebook-workspace",
        sources: [makeSource({ title: "TSLA-Q4-2025-Update.pdf" })],
        excludedSourceIds: [],
        retrieval,
        generateRetrievalQuery,
        generateAnswer,
        messages,
      }),
    );

    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "Tesla Q4 2025 Update energy generation and storage deployments",
      topK: 8,
    });
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What about energy storage in this document?",
      retrievalQuery:
        "Tesla Q4 2025 Update energy generation and storage deployments",
      messages,
      results: [
        makeRetrievalResult({
          source: {
            documentId: "doc_included",
            sourceFileName: "TSLA-Q4-2025-Update.pdf",
            sectionPath: "Intro",
          },
        }),
      ],
    });
  });
});

describe("generateContextualRetrievalQuery", () => {
  it("uses the latest question directly when there is no chat history", async () => {
    const query = await generateContextualRetrievalQuery({
      question: "What does Tesla say about energy storage?",
      messages: [],
      sources: [makeSource({ title: "TSLA-Q4-2025-Update.pdf" })],
      excludedSourceIds: [],
    });

    expect(generateText).not.toHaveBeenCalled();
    expect(query).toBe("What does Tesla say about energy storage?");
  });

  it("asks the model to produce a stateless Knowhere query from chat context", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    vi.mocked(generateText).mockResolvedValue({
      text: "Query: Tesla Q4 2025 Update energy storage deployments",
    } as Awaited<ReturnType<typeof generateText>>);

    const query = await generateContextualRetrievalQuery({
      question: "What about energy storage in this document?",
      messages: [
        {
          role: "user",
          content: "Tell me about Tesla's Q4 2025 update.",
        },
      ],
      sources: [makeSource({ title: "TSLA-Q4-2025-Update.pdf" })],
      excludedSourceIds: [],
    });

    expect(generateText).toHaveBeenCalledWith({
      model: "deepseek/deepseek-v4-flash",
      prompt: expect.stringContaining("Knowhere retrieval is stateless"),
    });
    expect(query).toBe("Tesla Q4 2025 Update energy storage deployments");
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
      retrievalQuery: "PR-E retrieval",
      messages: [],
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
    expect(prompt).toContain("Retrieval query used: What is PR-E?");
    expect(prompt).toContain("PR-E wires chat to Knowhere retrieval.");
    expect(prompt).toContain("requirements.txt");
    expect(prompt).toContain("don't answer the question, say so directly");
  });
});

describe("buildRetrievalQueryPrompt", () => {
  it("includes source and history context for stateless retrieval", () => {
    const prompt = buildRetrievalQueryPrompt({
      question: "What about energy storage in this document?",
      messages: [
        {
          role: "assistant",
          content: "Tesla's update mentions Q4 revenue.",
          citations: [
            {
              chunkType: "text",
              score: 0.9,
              source: {
                documentId: "doc_tesla",
                sourceFileName: "TSLA-Q4-2025-Update.pdf",
                sectionPath: "FINANCIAL SUMMARY",
              },
            },
          ],
        },
      ],
      sources: [
        makeSource({
          id: "source_tesla",
          title: "TSLA-Q4-2025-Update.pdf",
          knowhereDocumentId: "doc_tesla",
        }),
        makeSource({
          id: "source_excluded",
          title: "Other.pdf",
          knowhereDocumentId: "doc_other",
        }),
      ],
      excludedSourceIds: ["source_excluded"],
    });

    expect(prompt).toContain("Knowhere retrieval is stateless");
    expect(prompt).toContain("TSLA-Q4-2025-Update.pdf");
    expect(prompt).toContain("FINANCIAL SUMMARY");
    expect(prompt).toContain("What about energy storage in this document?");
    expect(prompt).not.toContain("Other.pdf");
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
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}
