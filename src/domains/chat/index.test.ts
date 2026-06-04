import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { generateText, ToolLoopAgent, type ModelMessage } from "ai"

import {
  answerQuestionWithRetrieval,
  buildAgenticChatSystemPrompt,
  buildGroundedPrompt,
  buildRetrievalQueryPrompt,
  generateAgenticGroundedAnswer,
  generateContextualRetrievalQuery,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "."
import type { Source } from "@/infrastructure/db/schema"
import type {
  AgenticRetrievalQuery,
  ReadRetrievedChunkInput,
} from "./contracts"

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: loggerMock.info,
    warn: loggerMock.warn,
    error: loggerMock.error,
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(generateText).mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  delete process.env.AI_GATEWAY_API_KEY;
});

describe("answerQuestionWithRetrieval", () => {
  it("queries the workspace namespace and excludes unchecked ready documents", async () => {
    const result = makeRetrievalResult();
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Grounding content from evidence tree",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "What does the document say?",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "What does the document say?" });
      return "The answer is grounded.";
    });
    const sources = [
      makeSource({ knowhereDocumentId: "doc_included" }),
      makeSource({ id: "source_2", knowhereDocumentId: "doc_excluded" }),
    ];

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the document say?",
        namespace: "notebook-workspace",
        sources,
        excludedSourceIds: ["source_2"],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "What does the document say?",
      topK: 8,
      useAgentic: true,
      excludeDocumentIds: ["doc_excluded"],
    });
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What does the document say?",
      messages: [],
      sources,
      excludedSourceIds: ["source_2"],
      searchSources: expect.any(Function),
      readRetrievedChunk: expect.any(Function),
    });
    expect(answer).toEqual({
      answer: "The answer is grounded.",
      citations: [result],
    });
  });

  it("logs bounded Knowhere query response chunks", async () => {
    const result = makeRetrievalResult({
      chunkType: "image",
      content: `Identity card front image https://blob.example/id.jpg ${"content ".repeat(
        80,
      )}`,
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: `Evidence https://blob.example/evidence.jpg ${"evidence ".repeat(
          80,
        )}`,
        referencedChunks: [
          {
            chunkId: "chunk_identity_1",
            documentId: "doc_identity",
            chunkType: "image",
            sectionPath: `Assets / images / identity card front ${"summary ".repeat(
              80,
            )}`,
            filePath: "images/id-front.jpg",
            jobId: "job_1",
            assetUrl: "https://blob.example/id.jpg",
          },
        ],
        namespace: "notebook-workspace",
        query: "冯荣洲 身份证 ID card",
        routerUsed: "workflow_single_step",
        answerText: `Matched identity card image ${"answer ".repeat(80)}`,
        stopReason: "answer_done",
        failureReason: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({
        query: "冯荣洲 身份证 ID card",
        intent: "image",
        dataType: 3,
      });
      return "Matched identity card image.";
    });

    await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "请将 冯荣洲 的身份证图片发给我",
        namespace: "notebook-workspace",
        sources: [makeSource({ knowhereDocumentId: "doc_identity" })],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    const meta = getLoggerInfoMeta("chat-agent: knowhere query response");
    const response = meta.response as KnowhereQueryResponseLogMeta;
    expect(response).toMatchObject({
      query: "冯荣洲 身份证 ID card",
      resultCount: 1,
      referencedChunkCount: 1,
      results: [
        {
          chunkType: "image",
        },
      ],
      referencedChunks: [
        {
          chunkType: "image",
        },
      ],
    });
    expect(response.answerText.length).toBeLessThanOrEqual(203);
    expect(response.evidenceText.length).toBeLessThanOrEqual(203);
    expect(response.results[0]?.content.length).toBeLessThanOrEqual(103);
    expect(response.referencedChunks[0]?.summary.length).toBeLessThanOrEqual(
      103,
    );
    expect(JSON.stringify(meta)).not.toContain("https://blob.example");
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
        evidenceText: "Revenue grew. Gross margin improved.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "What improved?",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "What improved?" });
      return "Revenue improved [Source 1: revenue growth]. Margins expanded [Source 2: margin expansion].";
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What improved?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
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
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Tesla invested in xAI.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "Tesla xAI investment",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "Tesla xAI investment" });
      return "Tesla invested in xAI [Source 1: xAI investment].";
    });
    const sources = [
      makeSource({
        title: "TSLA-Q4-2025-Update.pdf",
        knowhereDocumentId: "doc_tesla",
      }),
    ];

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the document say about xAI?",
        namespace: "notebook-workspace",
        sources,
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What does the document say about xAI?",
      messages: [],
      sources,
      excludedSourceIds: [],
      searchSources: expect.any(Function),
      readRetrievedChunk: expect.any(Function),
    });
    const expectedResult = {
      ...result,
      source: {
        ...result.source,
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
      },
    };
    expect(answer.citations).toEqual([
      { ...expectedResult, description: "xAI investment" },
    ]);
  });

  it("passes retrieved image asset URLs to the answer prompt and citations", async () => {
    const result = makeRetrievalResult({
      chunkType: "image",
      source: {
        documentId: "doc_spacex",
        sourceFileName: "document-generated.pdf",
        sectionPath: "Assets / images / image-9-Night Rocket Launch.jpg",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "A SpaceX rocket launches at night.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "SpaceX rocket photos",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({
        query: "SpaceX rocket photos",
        intent: "image",
        purpose: "Find visual rocket launch chunks.",
        priority: 5,
      });
      return "Use this launch photo. https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg";
    });
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/image-9-Night Rocket Launch.jpg":
        "https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Show me the SpaceX rocket photos.",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_spacex",
            title: "spacex-s1.pdf",
            knowhereDocumentId: "doc_spacex",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        loadSourceAssetUrls,
        messages: [],
      }),
    );

    expect(loadSourceAssetUrls).toHaveBeenCalledWith(
      expect.objectContaining({ id: "source_spacex" }),
    );
    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "SpaceX rocket photos",
      topK: 8,
      useAgentic: true,
      dataType: 3,
    });
    expect(answer.answer).toBe("Use this launch photo.");
    expect(answer.citations).toEqual([
      {
        ...result,
        assetUrl:
          "https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
        source: {
          ...result.source,
          sourceFileName: "spacex-s1.pdf",
        },
      },
    ]);
  });

  it("turns retrieved evidence image filenames into image citations", async () => {
    const result = makeRetrievalResult({
      content: "This section contains identity proof attachments.",
      source: {
        documentId: "doc_identity",
        sourceFileName: "document-generated.pdf",
        sectionPath: "二、法定代表人身份证明",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText:
          "[image-6-中华人民共和国居民身份证.jpg]\n[image-7-中国居民身份证.jpg]",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "公民身份证明 图片",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "公民身份证明 图片", dataType: 3 });
      return "这里是相关身份证明图片。";
    });
    const loadSourceAssetUrls = vi.fn().mockResolvedValue({
      "images/image-6-中华人民共和国居民身份证.jpg":
        "https://blob.example/images/image-6-id-front.jpg",
      "images/image-7-中国居民身份证.jpg":
        "https://blob.example/images/image-7-id-back.jpg",
    });
    const sources = [
      makeSource({
        id: "source_identity",
        title: "商务标文件.pdf",
        knowhereDocumentId: "doc_identity",
      }),
    ];

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "请发送几张关于公民身份的图片给我",
        namespace: "notebook-workspace",
        sources,
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        loadSourceAssetUrls,
        messages: [],
      }),
    );

    expect(generateAnswer).toHaveBeenCalledWith({
      question: "请发送几张关于公民身份的图片给我",
      messages: [],
      sources,
      excludedSourceIds: [],
      searchSources: expect.any(Function),
      readRetrievedChunk: expect.any(Function),
    });
    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "公民身份证明 图片",
      topK: 8,
      useAgentic: true,
      dataType: 3,
    });
    expect(answer.citations.map((citation) => citation.assetUrl)).toEqual([
      undefined,
      "https://blob.example/images/image-6-id-front.jpg",
      "https://blob.example/images/image-7-id-back.jpg",
    ]);
    expect(answer.citations.slice(1).map((citation) => citation.chunkType)).toEqual([
      "image",
      "image",
    ]);
  });

  it("returns the agent answer without citations when retrieval has no results", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [],
        evidenceText: "",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "Missing fact?",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "Missing fact?" });
      return "I couldn't find that in your sources.";
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Missing fact?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer).toEqual({
      answer: "I couldn't find that in your sources.",
      citations: [],
    });
  });

  it("lets the agent issue contextual retrieval queries while answering the original question", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
        evidenceText: "Energy storage deployments grew significantly.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "Tesla Q4 2025 Update energy generation and storage deployments",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({
        query: "Tesla Q4 2025 Update energy generation and storage deployments",
      });
      return "Energy storage grew.";
    });
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
        generateAnswer,
        messages,
      }),
    );

    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "Tesla Q4 2025 Update energy generation and storage deployments",
      topK: 8,
      useAgentic: true,
    });
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What about energy storage in this document?",
      messages,
      sources: [makeSource({ title: "TSLA-Q4-2025-Update.pdf" })],
      excludedSourceIds: [],
      searchSources: expect.any(Function),
      readRetrievedChunk: expect.any(Function),
    });
  });

  it("does not append chat history to Knowhere tool queries", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
        evidenceText: "Energy storage deployments grew.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "Tesla energy storage deployments",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "Tesla energy storage deployments" });
      return "Energy storage grew.";
    });
    const messages = [
      {
        role: "user" as const,
        content: "do-not-append-this-history-to-query",
      },
      {
        role: "assistant" as const,
        content: "This older answer should not be concatenated into retrieval.",
      },
    ];

    await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What about it?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages,
      }),
    );

    const queryInput = retrieval.query.mock.calls[0]?.[0];
    expect(queryInput).toMatchObject({
      namespace: "notebook-workspace",
      query: "Tesla energy storage deployments",
      topK: 8,
      useAgentic: true,
    });
    expect(JSON.stringify(queryInput)).not.toContain(
      "do-not-append-this-history-to-query",
    );
  });

  it("lets the agent read untruncated content from returned chunk ids", async () => {
    const longContent = `${"Earlier context. ".repeat(160)}Critical obligation: retain source receipts.`;
    const result = {
      ...makeRetrievalResult({
        content: longContent,
        source: {
          documentId: "doc_contract",
          sourceFileName: "contract.pdf",
          sectionPath: "Obligations",
        },
      }),
      chunkId: "chunk_contract_1",
    } as RetrievalResult & { readonly chunkId: string };
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Contract obligations were retrieved.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "contract obligations",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(
      async ({ searchSources, readRetrievedChunk }) => {
        const response = await searchSources({ query: "contract obligations" });
        expect(response.chunkReferences[0]).toMatchObject({
          id: "chunk_contract_1",
          chunkId: "chunk_contract_1",
          contentTruncated: true,
          contentLength: longContent.length,
        });

        const detail = await readRetrievedChunk({
          id: "chunk_contract_1",
          offset: 2_000,
          limit: 80,
        });

        expect(detail).toMatchObject({
          id: "chunk_contract_1",
          found: true,
          offset: 2_000,
          limit: 80,
          contentLength: longContent.length,
        });
        return detail.contentSlice;
      },
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What obligation matters?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            title: "contract.pdf",
            knowhereDocumentId: "doc_contract",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.answer).toBe(longContent.slice(2_000, 2_080));
  });

  it("uses structured referenced chunks from RetrievalQueryResponse as citations", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [],
        evidenceText: "A launch image was referenced.",
        referencedChunks: [
          {
            chunkId: "chunk_1",
            documentId: "doc_spacex",
            chunkType: "image",
            sectionPath: "Assets / images / launch.jpg",
            filePath: "images/launch.jpg",
            jobId: "job_1",
            assetUrl: "https://blob.example/images/launch.jpg",
          },
        ],
        namespace: "notebook-workspace",
        query: "SpaceX launch image",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "SpaceX launch image", dataType: 3 });
      return "Here is the launch image.";
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Show me the launch image.",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            title: "spacex-s1.pdf",
            knowhereDocumentId: "doc_spacex",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.citations).toEqual([
      {
        content: "",
        chunkType: "image",
        score: null,
        assetUrl: "https://blob.example/images/launch.jpg",
        source: {
          documentId: "doc_spacex",
          sourceFileName: "spacex-s1.pdf",
          sectionPath: "Assets / images / launch.jpg",
        },
      },
    ]);
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
      model: "google/gemini-3-flash",
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
      evidenceText: "PR-E wires chat to Knowhere retrieval.",
    });

    expect(generateText).toHaveBeenCalledWith({
      model: "google/gemini-3-flash",
      prompt: expect.stringContaining("PR-E wires chat to Knowhere retrieval."),
    });
    expect(answer).toBe("PR-E wires chat to retrieval.");
    expect(getLoggerInfoMeta("chat-agent: llm request")).toMatchObject({
      operation: "generateGroundedAnswer",
      model: "google/gemini-3-flash",
      promptType: "text",
      prompt: expect.stringContaining("PR-E wires chat to Knowhere retrieval."),
    });
    expect(getLoggerInfoMeta("chat-agent: llm response")).toMatchObject({
      operation: "generateGroundedAnswer",
      model: "google/gemini-3-flash",
      responseText: "PR-E wires chat to retrieval.",
      responseTextCharLength: "PR-E wires chat to retrieval.".length,
    });
  });
});

describe("generateAgenticGroundedAnswer", () => {
  it("builds a Vercel AI SDK tool loop around Knowhere retrieval", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    let capturedGenerateInput:
      | Parameters<ToolLoopAgent["generate"]>[0]
      | undefined;
    const generateSpy = vi
      .spyOn(ToolLoopAgent.prototype, "generate")
      .mockImplementation((
        input: Parameters<ToolLoopAgent["generate"]>[0],
      ): ReturnType<ToolLoopAgent["generate"]> => {
        capturedGenerateInput = input;
        return Promise.resolve({
          text: "Here are the requested identity images.",
        } as Awaited<ReturnType<ToolLoopAgent["generate"]>>);
      });
    const searchSources = vi.fn().mockResolvedValue({
      results: [
        makeRetrievalResult({
          content: "Identity card image front side.",
          chunkType: "image",
          assetUrl: "https://blob.example/images/id-front.jpg",
          source: {
            documentId: "doc_identity",
            sourceFileName: "document-generated.pdf",
            sectionPath: "Assets / images / id-front.jpg",
          },
        }),
      ],
      evidenceText:
        "Identity image evidence. https://blob.example/images/id-front.jpg",
      referencedChunks: [
        {
          chunkId: "chunk_identity_1",
          documentId: "doc_identity",
          chunkType: "image",
          sectionPath: "Assets / images / id-front.jpg",
          filePath: "images/id-front.jpg",
          jobId: "job_1",
          assetUrl: "https://blob.example/images/id-front.jpg",
        },
      ],
      namespace: "notebook-workspace",
      query: "公民身份证 图片",
      routerUsed: "workflow_single_step",
      retrievalPlan: {
        intent: "image",
        purpose: "Find identity-card image evidence.",
        priority: 5,
      },
      chunkReferences: [
        {
          id: "chunk_identity_1",
          chunkId: "chunk_identity_1",
          kind: "result",
          resultIndex: 1,
          chunkType: "image",
          score: 0.9,
          source: {
            documentId: "doc_identity",
            sourceFileName: "document-generated.pdf",
            sectionPath: "Assets / images / id-front.jpg",
          },
          hasAssetUrl: true,
          contentLength: "Identity card image front side.".length,
          contentPreview: "Identity card image front side.",
          contentTruncated: false,
        },
      ],
      answerText:
        "The source includes identity card images. https://blob.example/images/id-front.jpg",
      stopReason: "answer_done",
      failureReason: null,
      decisionTrace: [
        {
          step: "final",
          stop: "answer_done",
          assetUrl: "https://blob.example/images/id-front.jpg",
        },
      ],
    });
    const readRetrievedChunk = vi.fn().mockResolvedValue({
      id: "chunk_identity_1",
      chunkId: "chunk_identity_1",
      found: true,
      chunkType: "image",
      score: 0.9,
      source: {
        documentId: "doc_identity",
        sourceFileName: "document-generated.pdf",
        sectionPath: "Assets / images / id-front.jpg",
      },
      hasAssetUrl: true,
      offset: 0,
      limit: 80,
      contentLength: 96,
      contentSlice:
        "Full identity card text. https://blob.example/images/id-front.jpg",
      hasMoreContent: false,
      nextOffset: null,
    });

    const answer = await generateAgenticGroundedAnswer({
      question: "请发送几张关于公民身份的图片给我",
      messages: [],
      sources: [
        makeSource({
          title: "商务标文件.pdf",
          knowhereDocumentId: "doc_identity",
        }),
      ],
      excludedSourceIds: [],
      searchSources,
      readRetrievedChunk,
    });

    expect(answer).toBe("Here are the requested identity images.");
    expect(generateSpy).toHaveBeenCalledWith({
      messages: expect.any(Array),
    });
    const agent = getCapturedAgent(generateSpy.mock.contexts[0]);
    const settings = getCapturedAgentSettings(agent);
    const generateInput = getCapturedGenerateInput(capturedGenerateInput);

    expect(settings.instructions).toContain("RetrievalQueryResponse")
    expect(settings.instructions).toContain("L0/L1 retrieval")
    expect(settings.instructions).toContain("typed retrieval plan")
    expect(settings.instructions).toContain("dataType=3")
    expect(settings.instructions).toContain(
      "Do not paste raw prior messages into searchSources.query",
    )
    expect(generateInput.messages.at(-1)).toEqual({
      role: "user",
      content: "请发送几张关于公民身份的图片给我",
    })
    expect(
      settings.prepareStep({
        stepNumber: 0,
        messages: [...generateInput.messages],
      }),
    ).toMatchObject({
      toolChoice: { type: "tool", toolName: "searchSources" },
      activeTools: ["searchSources"],
    })

    const searchSourcesTool = getCapturedAgentTools(agent).searchSources
    expect(
      getSearchSourcesDataTypeSchema(searchSourcesTool)._def?.innerType?._def
        ?.type,
    ).toBe("number")
    expect(
      searchSourcesTool.inputSchema.safeParse({
        query: "公民身份证 图片",
        dataType: 3,
      }).success,
    ).toBe(true)
    expect(
      searchSourcesTool.inputSchema.safeParse({
        query: "公民身份证 图片",
        dataType: 7,
      }).success,
    ).toBe(false)

    const toolOutput = await searchSourcesTool.execute({
      query: "公民身份证 图片",
      intent: "image",
      purpose: "Find identity-card image evidence.",
      priority: 5,
      dataType: 3,
    });

    expect(searchSources).toHaveBeenCalledWith({
      query: "公民身份证 图片",
      intent: "image",
      purpose: "Find identity-card image evidence.",
      priority: 5,
      dataType: 3,
    });
    expect(toolOutput).toMatchObject({
      query: "公民身份证 图片",
      retrievalPlan: {
        intent: "image",
        purpose: "Find identity-card image evidence.",
        priority: 5,
      },
      routerUsed: "workflow_single_step",
      stopReason: "answer_done",
      failureReason: null,
      answerText:
        "The source includes identity card images. [media asset URL hidden]",
      resultCount: 1,
      referencedChunkCount: 1,
      hasEvidenceText: true,
      results: [
        expect.objectContaining({
          chunkType: "image",
          hasAssetUrl: true,
          content: "Identity card image front side.",
        }),
      ],
      referencedChunks: [
        expect.objectContaining({
          chunkId: "chunk_identity_1",
          chunkType: "image",
          filePath: "images/id-front.jpg",
          hasAssetUrl: true,
        }),
      ],
      agentGuidance: expect.stringContaining("Use this evidence"),
    });
    expect(JSON.stringify(toolOutput)).not.toContain("https://blob.example");

    const chunkOutput = await getCapturedAgentTools(agent).readRetrievedChunk.execute({
      id: "chunk_identity_1",
      offset: 0,
      limit: 80,
    });

    expect(readRetrievedChunk).toHaveBeenCalledWith({
      id: "chunk_identity_1",
      offset: 0,
      limit: 80,
    });
    expect(chunkOutput).toMatchObject({
      id: "chunk_identity_1",
      found: true,
      contentSlice: "Full identity card text. [media asset URL hidden]",
      hasMoreContent: false,
    });
    expect(JSON.stringify(chunkOutput)).not.toContain("https://blob.example");
  });

  it("uses managed context for stored history and loop steps", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    let capturedGenerateInput:
      | Parameters<ToolLoopAgent["generate"]>[0]
      | undefined;
    const generateSpy = vi
      .spyOn(ToolLoopAgent.prototype, "generate")
      .mockImplementation((
        input: Parameters<ToolLoopAgent["generate"]>[0],
      ): ReturnType<ToolLoopAgent["generate"]> => {
        capturedGenerateInput = input;
        return Promise.resolve({
          text: "The answer is grounded.",
        } as Awaited<ReturnType<ToolLoopAgent["generate"]>>);
      });
    const messages = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `history-message-${index} ${"context ".repeat(80)}`,
    }));

    await generateAgenticGroundedAnswer({
      question: "What should I know now?",
      messages,
      sources: [makeSource()],
      excludedSourceIds: [],
      searchSources: vi.fn(),
      readRetrievedChunk: vi.fn(),
    });

    const generateInput = getCapturedGenerateInput(capturedGenerateInput);
    const serializedMessages = JSON.stringify(generateInput.messages);
    expect(generateInput.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Compacted earlier conversation"),
    });
    expect(serializedMessages).not.toContain("history-message-0");
    expect(serializedMessages).toContain("history-message-23");

    const settings = getCapturedAgentSettings(
      getCapturedAgent(generateSpy.mock.contexts[0]),
    );
    const oversizedLoopMessages = Array.from({ length: 25 }, (_, index) => ({
      role: "user" as const,
      content: `loop-message-${index}`,
    }));
    const preparedStep = settings.prepareStep({
      stepNumber: 1,
      messages: oversizedLoopMessages,
    }) as { readonly messages: readonly ModelMessage[] };

    expect(preparedStep.messages.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(preparedStep.messages)).not.toContain("loop-message-0");
    expect(JSON.stringify(preparedStep.messages)).toContain("loop-message-24");
    expect(getLoggerInfoMeta("chat-agent: llm request")).toMatchObject({
      operation: "generateAgenticGroundedAnswer.step",
      model: "google/gemini-3-flash",
      promptType: "messages",
      stepNumber: 1,
      instructions: expect.stringContaining("Notebook research agent"),
      messageCount: preparedStep.messages.length,
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "loop-message-24",
        }),
      ]),
    });
  });

  it("logs bounded tool call and tool result previews for each loop step", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    const generateSpy = vi
      .spyOn(ToolLoopAgent.prototype, "generate")
      .mockResolvedValue({
        text: "The answer is grounded.",
      } as Awaited<ReturnType<ToolLoopAgent["generate"]>>);

    await generateAgenticGroundedAnswer({
      question: "请将 冯荣洲 的身份证图片发给我",
      messages: [],
      sources: [makeSource()],
      excludedSourceIds: [],
      searchSources: vi.fn(),
      readRetrievedChunk: vi.fn(),
    });

    const settings = getCapturedAgentSettings(
      getCapturedAgent(generateSpy.mock.contexts[0]),
    );
    loggerMock.info.mockClear();

    settings.onStepFinish({
      stepNumber: 1,
      finishReason: "tool-calls",
      text: `Inspecting identity image candidates. ${"reason ".repeat(200)}`,
      toolCalls: [
        {
          toolName: "searchSources",
          toolCallId: "call_1",
          input: {
            query: "冯荣洲 身份证 ID card",
            purpose: `Find the matching identity card image. ${"input ".repeat(
              300,
            )}`,
            dataType: 3,
          },
        },
      ],
      toolResults: [
        {
          toolName: "searchSources",
          toolCallId: "call_1",
          output: {
            query: "冯荣洲 身份证 ID card",
            routerUsed: "workflow_single_step",
            resultCount: 6,
            referencedChunkCount: 2,
            readableChunkCount: 6,
            evidenceText: `Image evidence https://blob.example/id-front.jpg ${"evidence ".repeat(
              600,
            )}`,
            results: [
              {
                chunkType: "image",
                content: `Identity image content ${"result ".repeat(80)}`,
              },
            ],
            referencedChunks: [
              {
                chunkType: "image",
                sectionPath: `Assets / identity card ${"reference ".repeat(80)}`,
              },
            ],
          },
        },
      ],
      usage: {
        inputTokens: 11,
        outputTokens: 22,
        totalTokens: 33,
      },
    });

    const stepMeta = getLoggerInfoMeta("chat-agent: llm response");
    const stepLog = stepMeta as unknown as AgentLoopStepLogMeta;
    expect(stepLog).toMatchObject({
      operation: "generateAgenticGroundedAnswer.step",
      model: "google/gemini-3-flash",
      stepNumber: 1,
      finishReason: "tool-calls",
      toolCallCount: 1,
      toolResultCount: 1,
      inputTokens: 11,
      outputTokens: 22,
      totalTokens: 33,
    });
    expect(stepLog.responseText).toContain("Inspecting identity image candidates.");
    expect(stepLog.toolCalls[0]?.input.truncated).toBe(true);
    expect(stepLog.toolResults[0]?.output).toMatchObject({
      kind: "searchSources",
      query: "冯荣洲 身份证 ID card",
      resultCount: 6,
      results: [
        {
          chunkType: "image",
        },
      ],
      referencedChunks: [
        {
          chunkType: "image",
        },
      ],
    });
    const searchSourcesOutput = stepLog.toolResults[0]
      ?.output as SearchSourcesToolOutputLogMeta;
    expect(searchSourcesOutput.evidenceText.length).toBeLessThanOrEqual(203);
    expect(searchSourcesOutput.results[0]?.content.length).toBeLessThanOrEqual(
      103,
    );
    expect(
      searchSourcesOutput.referencedChunks[0]?.summary.length,
    ).toBeLessThanOrEqual(103);
    expect(JSON.stringify(stepMeta)).not.toContain("https://blob.example");

    settings.onFinish({
      steps: [
        {
          stepNumber: 1,
          finishReason: "tool-calls",
          text: "Read tool result.",
          toolCalls: [
            {
              toolName: "searchSources",
              toolCallId: "call_1",
              input: { query: "冯荣洲 身份证 ID card" },
            },
          ],
          toolResults: [
            {
              toolName: "searchSources",
              toolCallId: "call_1",
              output: { evidenceText: "Matched image evidence." },
            },
          ],
        },
      ],
      finishReason: "stop",
      text: "Here is the matched identity card image.",
      totalUsage: {
        inputTokens: 40,
        outputTokens: 20,
        totalTokens: 60,
      },
    });

    const finishMeta = getLoggerInfoMeta("chat-agent: loop finished");
    expect(finishMeta).toMatchObject({
      stepCount: 1,
      finishReason: "stop",
      responseText: "Here is the matched identity card image.",
      toolNames: ["searchSources"],
      steps: [
        expect.objectContaining({
          stepNumber: 1,
          toolCallCount: 1,
          toolResultCount: 1,
        }),
      ],
      inputTokens: 40,
      outputTokens: 20,
      totalTokens: 60,
    });
  });
});

describe("buildGroundedPrompt", () => {
  it("includes evidence text and uses evidence-based citation format", () => {
    const prompt = buildGroundedPrompt({
      question: "What is PR-E?",
      evidenceText: "PR-E wires chat to Knowhere retrieval.\n[Document] requirements.txt\n▸ [L1] N-005",
    });

    expect(prompt).toContain("What is PR-E?");
    expect(prompt).toContain("Retrieval query used: What is PR-E?");
    expect(prompt).toContain("PR-E wires chat to Knowhere retrieval.");
    expect(prompt).toContain("requirements.txt");
    expect(prompt).toContain(
      "Use the retrieved evidence as your primary context.",
    );
    expect(prompt).toContain("Retrieved evidence:");
    expect(prompt).not.toContain("Source excerpts:");
  });

  it("asks the model to answer naturally and directly", () => {
    const prompt = buildGroundedPrompt({
      question: "How about the TBD?",
      evidenceText: "Roadster location: TBD. Status: Design development.",
    });

    expect(prompt).toContain("Answer in a natural, friendly, and direct tone.");
    expect(prompt).toContain("Start with the answer first.");
    expect(prompt).toContain("Avoid meta phrases like \"Based on the sources\"");
    expect(prompt).toContain("Keep answers concise by default");
    expect(prompt).toContain(
      "If the sources are related but incomplete, answer what you can and briefly say what is not covered.",
    );
  });

  it("includes retrieved media asset references as internal metadata", () => {
    const prompt = buildGroundedPrompt({
      question: "Show me the launch image.",
      evidenceText: "A launch image was retrieved.",
      mediaAssetContext:
        "- spacex-s1.pdf / Assets / images / launch.jpg: https://blob.example/images/launch.jpg",
    });

    expect(prompt).toContain(
      "Retrieved media asset references (internal; do not quote raw URLs):",
    );
    expect(prompt).toContain(
      "When retrieved image or table asset references are relevant to the user's request, cite the matching source label; the UI renders media from citation metadata.",
    );
    expect(prompt).toContain(
      "Do not write raw media asset URLs in the answer. They are internal metadata only.",
    );
    expect(prompt).toContain("https://blob.example/images/launch.jpg");
  });
});

describe("buildAgenticChatSystemPrompt", () => {
  it("instructs the agent how to continue or stop from retrieval responses", () => {
    const prompt = buildAgenticChatSystemPrompt({
      messages: [],
      sources: [makeSource({ title: "商务标文件.pdf" })],
      excludedSourceIds: [],
    });

    expect(prompt).toContain("Always call searchSources")
    expect(prompt).toContain("readRetrievedChunk")
    expect(prompt).toContain("L0/L1 retrieval")
    expect(prompt).toContain("typed retrieval plan")
    expect(prompt).toContain("evidenceText")
    expect(prompt).toContain("failureReason")
    expect(prompt).toContain("decisionTrace")
    expect(prompt).toContain("remote source index")
    expect(prompt).toContain("person or section but not an image asset")
    expect(prompt).toContain("Do not paste raw prior messages")
    expect(prompt).toContain("身份证")
    expect(prompt).toContain("For image requests use intent=image")
    expect(prompt).toContain("商务标文件.pdf")
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

type CapturedAgentSettings = {
  readonly instructions: string
  readonly prepareStep: (input: {
    readonly stepNumber: number
    readonly messages: ModelMessage[]
  }) => unknown
  readonly onStepFinish: (input: unknown) => void
  readonly onFinish: (input: unknown) => void
}

type CapturedAgentTools = {
  readonly searchSources: {
    readonly inputSchema: {
      readonly _def?: {
        readonly type?: string
        readonly shape?:
          | Record<string, CapturedZodSchema>
          | (() => Record<string, CapturedZodSchema>)
      }
      readonly safeParse: (value: unknown) => { readonly success: boolean }
    }
    readonly execute: (input: AgenticRetrievalQuery) => Promise<unknown>
  }
  readonly readRetrievedChunk: {
    readonly execute: (input: ReadRetrievedChunkInput) => Promise<unknown>
  }
}

type CapturedZodSchema = {
  readonly _def?: {
    readonly type?: string
    readonly innerType?: CapturedZodSchema
  }
}

type AgentLoopStepLogMeta = {
  readonly operation: string
  readonly model: string
  readonly stepNumber: number
  readonly finishReason: string
  readonly responseText: string
  readonly toolCallCount: number
  readonly toolCalls: readonly {
    readonly input: AgentLoopLogPreviewMeta
  }[]
  readonly toolResultCount: number
  readonly toolResults: readonly {
    readonly output: SearchSourcesToolOutputLogMeta | AgentLoopLogPreviewMeta
  }[]
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

type SearchSourcesToolOutputLogMeta = {
  readonly kind: "searchSources"
  readonly evidenceText: string
  readonly results: readonly {
    readonly content: string
  }[]
  readonly referencedChunks: readonly {
    readonly summary: string
  }[]
}

type AgentLoopLogPreviewMeta = {
  readonly truncated: boolean
  readonly preview: string
}

type KnowhereQueryResponseLogMeta = {
  readonly query: string
  readonly resultCount: number
  readonly referencedChunkCount: number
  readonly answerText: string
  readonly evidenceText: string
  readonly results: readonly {
    readonly chunkType: string
    readonly content: string
  }[]
  readonly referencedChunks: readonly {
    readonly chunkType: string
    readonly summary: string
  }[]
}

function getCapturedAgent(agent: unknown): ToolLoopAgent {
  expect(agent).toBeInstanceOf(ToolLoopAgent)
  return agent as ToolLoopAgent
}

function getCapturedGenerateInput(
  input: Parameters<ToolLoopAgent["generate"]>[0] | undefined,
): { readonly messages: ModelMessage[] } {
  expect(input).toBeDefined()
  return input as { readonly messages: ModelMessage[] }
}

function getCapturedAgentSettings(agent: ToolLoopAgent): CapturedAgentSettings {
  return (agent as unknown as { readonly settings: CapturedAgentSettings })
    .settings
}

function getCapturedAgentTools(agent: ToolLoopAgent): CapturedAgentTools {
  return agent.tools as unknown as CapturedAgentTools
}

function getSearchSourcesDataTypeSchema(
  tool: CapturedAgentTools["searchSources"],
): CapturedZodSchema {
  const shape = tool.inputSchema._def?.shape
  const fields = typeof shape === "function" ? shape() : shape
  if (!fields) {
    throw new Error("searchSources input schema should expose fields.")
  }

  const dataTypeSchema = fields.dataType
  if (!dataTypeSchema) {
    throw new Error("searchSources input schema should include dataType.")
  }

  return dataTypeSchema
}

function getLoggerInfoMeta(message: string): Record<string, unknown> {
  const calls = loggerMock.info.mock.calls as unknown as readonly (readonly [
    string,
    Record<string, unknown> | undefined,
  ])[]
  const call = calls.findLast(([currentMessage]) => currentMessage === message)
  expect(call).toBeDefined()
  const meta = call?.[1]
  expect(meta).toBeDefined()
  return meta ?? {}
}
