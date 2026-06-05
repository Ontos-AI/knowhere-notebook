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
      dataType: 1,
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
        targetContent: "image",
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
        targetContent: "image",
        purpose: "Find visual rocket launch chunks.",
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
      await searchSources({
        query: "公民身份证明 图片",
        targetContent: "image",
      });
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
      "https://blob.example/images/image-6-id-front.jpg",
      "https://blob.example/images/image-7-id-back.jpg",
    ]);
    expect(answer.citations.map((citation) => citation.chunkType)).toEqual([
      "image",
      "image",
    ]);
  });

  it("sends requested identity-card images without exposing internal media metadata", async () => {
    const frontAssetUrl = "https://blob.example/images/feng-rongzhou-id-front.jpg";
    const backAssetUrl = "https://blob.example/images/feng-rongzhou-id-back.jpg";
    const unrelatedAssetUrl = "https://blob.example/images/company-license.jpg";
    const textResult = makeRetrievalResult({
      content: "冯荣洲的法定代表人身份证明页包含居民身份证图片。",
      source: {
        documentId: "doc_identity",
        sourceFileName: "document-generated.pdf",
        sectionPath: "二、法定代表人身份证明",
      },
    });
    const duplicateFrontResult = {
      ...makeRetrievalResult({
        chunkType: "image",
        content: "冯荣洲居民身份证正面图片。",
        assetUrl: frontAssetUrl,
        source: {
          documentId: "doc_identity",
          sourceFileName: "document-generated.pdf",
          sectionPath: "images/feng-rongzhou-id-front.jpg",
        },
      }),
      chunkId: "chunk_front_direct",
    } as RetrievalResult & { readonly chunkId: string };
    const richerDuplicateFrontResult = {
      ...makeRetrievalResult({
        chunkType: "image",
        content: "冯荣洲居民身份证正面图片，来源于身份证明章节。",
        assetUrl: frontAssetUrl,
        source: {
          documentId: "doc_identity",
          sourceFileName: "document-generated.pdf",
          sectionPath: "二、法定代表人身份证明 / 身份证正面",
        },
      }),
      chunkId: "chunk_front_richer",
    } as RetrievalResult & { readonly chunkId: string };
    const backResult = {
      ...makeRetrievalResult({
        chunkType: "image",
        content: "冯荣洲居民身份证反面图片。",
        assetUrl: backAssetUrl,
        source: {
          documentId: "doc_identity",
          sourceFileName: "document-generated.pdf",
          sectionPath: "二、法定代表人身份证明 / 身份证反面",
        },
      }),
      chunkId: "chunk_back",
    } as RetrievalResult & { readonly chunkId: string };
    const unrelatedImageResult = {
      ...makeRetrievalResult({
        chunkType: "image",
        content: "公司证照图片。",
        assetUrl: unrelatedAssetUrl,
        source: {
          documentId: "doc_identity",
          sourceFileName: "document-generated.pdf",
          sectionPath: "images/company-license.jpg",
        },
      }),
      chunkId: "chunk_company_license",
    } as RetrievalResult & { readonly chunkId: string };
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [
          textResult,
          duplicateFrontResult,
          richerDuplicateFrontResult,
          backResult,
          unrelatedImageResult,
        ],
        evidenceText: "冯荣洲 身份证 图片",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "冯荣洲 身份证 图片",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({
        query: "冯荣洲 身份证 图片",
        targetContent: "image",
        purpose: "查找冯荣洲的身份证图片。",
      });
      return [
        "为您找到冯荣洲的居民身份证图片，相关信息如下：",
        "- **姓名**：冯荣洲",
        "- **公民身份号码**：123456789012345678",
        "- **签发机关**：某公安局",
        "- **有效期限**：长期",
        `{"asset_id":"asset_front","assetUrl":"${frontAssetUrl}","chunkId":"chunk_front_direct"}`,
      ].join("\n");
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
        question: "请将 冯荣洲 的身份证图片发给我",
        namespace: "notebook-workspace",
        sources,
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "冯荣洲 身份证 图片",
      topK: 8,
      useAgentic: true,
      dataType: 3,
    });
    expect(answer.answer).toBe("已找到相关身份证图片，见下方图片。");
    expect(answer.answer).not.toMatch(
      /asset_id|assetUrl|asset_url|chunkId|chunk_id|https?:\/\//,
    );
    expect(answer.answer).not.toMatch(
      /姓名|公民身份号码|签发机关|有效期限|123456789012345678/,
    );
    expect(answer.citations.map((citation) => citation.assetUrl)).toEqual([
      frontAssetUrl,
      backAssetUrl,
    ]);
    expect(
      answer.citations.filter(
        (citation) => citation.assetUrl === frontAssetUrl,
      ),
    ).toHaveLength(1);
    expect(answer.citations[0]?.source).toMatchObject({
      sourceFileName: "商务标文件.pdf",
      sectionPath: "二、法定代表人身份证明 / 身份证正面",
    });
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
      dataType: 1,
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
      dataType: 1,
    });
    expect(JSON.stringify(queryInput)).not.toContain(
      "do-not-append-this-history-to-query",
    );
  });

  it("lets the agent read untruncated content from returned chunk ids", async () => {
    const longContent = `${"Earlier context. ".repeat(300)}Critical obligation: retain source receipts.`;
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
          offset: 4_000,
          limit: 80,
        });

        expect(detail).toMatchObject({
          id: "chunk_contract_1",
          found: true,
          offset: 4_000,
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

    expect(answer.answer).toBe(longContent.slice(4_000, 4_080).trim());
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
      await searchSources({
        query: "SpaceX launch image",
        targetContent: "image",
      });
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
    const previewWithinNewLimitMarker = "within-new-preview-limit";
    const previewAfterNewLimitMarker = "after-new-preview-limit";
    const fullToolOutputEvidenceMarker = "full-tool-output-evidence-end";
    const evidenceTreeText = [
      "Identity image evidence. https://blob.example/images/id-front.jpg",
      "[Document] document-generated.pdf",
      "▸ [L1] Assets",
      "  ▸ [L2] images / id-front.jpg",
      `    ┈ ${"evidence ".repeat(500)}${fullToolOutputEvidenceMarker}`,
    ].join("\n");
    const longIdentityPreview = [
      "Identity card image front side.",
      "preview ".repeat(170),
      previewWithinNewLimitMarker,
      "preview ".repeat(70),
      previewAfterNewLimitMarker,
    ].join(" ");
    const searchSources = vi.fn().mockResolvedValue({
      results: [
        makeRetrievalResult({
          content: longIdentityPreview,
          chunkType: "image",
          assetUrl: "https://blob.example/images/id-front.jpg",
          source: {
            documentId: "doc_identity",
            sourceFileName: "document-generated.pdf",
            sectionPath: "Assets / images / id-front.jpg",
          },
        }),
      ],
      evidenceText: evidenceTreeText,
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
        targetContent: "image",
        purpose: "Find identity-card image evidence.",
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
          contentLength: longIdentityPreview.length,
          contentPreview: longIdentityPreview,
          contentTruncated: true,
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

    expect(settings.instructions).toContain("markdown output gives guidance")
    expect(settings.instructions).toContain("image or text+image search")
    expect(settings.instructions).toContain("Read IDs")
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
    expect(
      settings.prepareStep({
        stepNumber: 1,
        messages: [...generateInput.messages],
      }),
    ).toMatchObject({
      toolChoice: { type: "tool", toolName: "searchSources" },
      activeTools: ["searchSources"],
    })
    expect(
      settings.prepareStep({
        stepNumber: 2,
        messages: [...generateInput.messages],
      }),
    ).toMatchObject({
      messages: expect.any(Array),
    })

    const searchSourcesTool = getCapturedAgentTools(agent).searchSources
    expect(
      getSearchSourcesTargetContentSchema(searchSourcesTool)._def?.innerType
        ?._def?.type,
    ).toBe("enum")
    expect(
      searchSourcesTool.inputSchema.safeParse({
        query: "公民身份证 图片",
        targetContent: "image",
      }).success,
    ).toBe(true)
    expect(
      searchSourcesTool.inputSchema.safeParse({
        query: "公民身份证 图片",
        targetContent: "video",
      }).success,
    ).toBe(false)

    const toolOutput = await searchSourcesTool.execute({
      query: "公民身份证 图片",
      targetContent: "image",
      purpose: "Find identity-card image evidence.",
    });

    expect(searchSources).toHaveBeenCalledWith({
      query: "公民身份证 图片",
      targetContent: "image",
      purpose: "Find identity-card image evidence.",
    });
    expect(toolOutput).toEqual(expect.any(String));
    expect(toolOutput).toContain("## Retrieval Result");
    expect(toolOutput).toContain("Query: 公民身份证 图片");
    expect(toolOutput).toContain("Guidance: Use this evidence");
    expect(toolOutput).toContain("## Evidence");
    expect(toolOutput).toContain(
      "[Document] document-generated.pdf\n▸ [L1] Assets\n  ▸ [L2] images / id-front.jpg",
    );
    expect(toolOutput).toContain(fullToolOutputEvidenceMarker);
    expect(toolOutput).not.toContain(
      "[Document] document-generated.pdf ▸ [L1] Assets",
    );
    expect(toolOutput).toContain("## Decision Trace");
    expect(toolOutput).toContain("- Step 1:");
    expect(toolOutput).toContain("- step: final");
    expect(toolOutput).toContain("- stop: answer_done");
    expect(toolOutput).toContain("### Result 1");
    expect(toolOutput).toContain("Type: image");
    expect(toolOutput).toContain(
      "Source: document-generated.pdf / Assets / images / id-front.jpg",
    );
    expect(toolOutput).toContain("Media: image available");
    expect(toolOutput).toContain("Read ID: chunk_identity_1");
    expect(toolOutput).toContain("Identity card image front side.");
    expect(toolOutput).toContain(previewWithinNewLimitMarker);
    expect(toolOutput).not.toContain(previewAfterNewLimitMarker);
    expect(toolOutput).not.toContain("https://blob.example");
    expect(toolOutput).not.toContain("assetUrl");
    expect(toolOutput).not.toContain("retrievalPlan");
    expect(toolOutput).not.toContain("decisionTrace");
    expect(getLoggerInfoMeta("chat-agent: tool output")).toMatchObject({
      toolName: "searchSources",
      output: expect.objectContaining({
        truncated: false,
        preview: expect.stringContaining(fullToolOutputEvidenceMarker),
      }),
    });

    const readRetrievedChunkTool = getCapturedAgentTools(agent).readRetrievedChunk;
    expect(
      readRetrievedChunkTool.inputSchema.safeParse({
        id: "chunk_identity_1",
        limit: 8_000,
      }).success,
    ).toBe(true);
    expect(
      readRetrievedChunkTool.inputSchema.safeParse({
        id: "chunk_identity_1",
        limit: 8_001,
      }).success,
    ).toBe(false);

    const chunkOutput = await readRetrievedChunkTool.execute({
      id: "chunk_identity_1",
      offset: 0,
      limit: 80,
    });

    expect(readRetrievedChunk).toHaveBeenCalledWith({
      id: "chunk_identity_1",
      offset: 0,
      limit: 80,
    });
    expect(chunkOutput).toEqual(expect.any(String));
    expect(chunkOutput).toContain("## Retrieved Content");
    expect(chunkOutput).toContain("Status: found");
    expect(chunkOutput).toContain("Read ID: chunk_identity_1");
    expect(chunkOutput).toContain(
      "Source: document-generated.pdf / Assets / images / id-front.jpg",
    );
    expect(chunkOutput).toContain(
      "Full identity card text. [media asset URL hidden]",
    );
    expect(chunkOutput).not.toContain("https://blob.example");
    expect(chunkOutput).not.toContain("chunkId");
    expect(getLoggerInfoMeta("chat-agent: tool output")).toMatchObject({
      toolName: "readRetrievedChunk",
      output: expect.objectContaining({
        truncated: false,
        preview: expect.stringContaining("## Retrieved Content\n\nStatus"),
      }),
    });
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
      stepNumber: 2,
      messages: oversizedLoopMessages,
    }) as { readonly messages: readonly ModelMessage[] };

    expect(preparedStep.messages.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(preparedStep.messages)).not.toContain("loop-message-0");
    expect(JSON.stringify(preparedStep.messages)).toContain("loop-message-24");
    expect(getLoggerInfoMeta("chat-agent: llm request")).toMatchObject({
      operation: "generateAgenticGroundedAnswer.step",
      model: "google/gemini-3-flash",
      promptType: "messages",
      stepNumber: 2,
      instructions: expect.stringContaining("Notebook research agent"),
      messageCount: preparedStep.messages.length,
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "loop-message-24",
        }),
      ]),
    });

    const hugeLoopMessages = [
      {
        role: "user" as const,
        content: `huge-loop-message ${"context ".repeat(9_000)}`,
      },
      {
        role: "assistant" as const,
        content: "middle-loop-message",
      },
      {
        role: "user" as const,
        content: "latest-loop-message",
      },
    ];
    const preparedHugeStep = settings.prepareStep({
      stepNumber: 2,
      messages: hugeLoopMessages,
    }) as { readonly messages: readonly ModelMessage[] };
    const serializedHugeStepMessages = JSON.stringify(
      preparedHugeStep.messages,
    );

    expect(getTestModelMessagesCharLength(preparedHugeStep.messages)).toBeLessThanOrEqual(
      64_000,
    );
    expect(serializedHugeStepMessages).not.toContain("huge-loop-message");
    expect(serializedHugeStepMessages).toContain("latest-loop-message");
  });

  it("logs bounded tool calls and complete tool results for each loop step", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    const fullStepToolOutputMarker = "full-step-tool-output-end";
    const fullStepToolOutput = `\n${[
      "## Retrieval Result",
      "",
      "Status: useful_evidence_found",
      "Query: 冯荣洲 身份证 ID card",
      "Guidance: Use this evidence if it directly answers the user.",
      "",
      "## Evidence",
      `Image evidence https://blob.example/id-front.jpg ${"evidence ".repeat(
        600,
      )}`,
      "",
      "## Results",
      "### Result 1",
      "Type: image",
      "Source: 商务标文件.pdf / 二、法定代表人身份证明",
      "Media: image available",
      "Read ID: chunk_identity_1",
      "",
      "Preview:",
      `Identity image content ${"result ".repeat(80)}`,
      fullStepToolOutputMarker,
    ].join("\n")}\n  `;
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
            targetContent: "image",
          },
        },
      ],
      toolResults: [
        {
          toolName: "searchSources",
          toolCallId: "call_1",
          output: fullStepToolOutput,
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
      output: {
        truncated: false,
      },
    });
    const searchSourcesOutput = stepLog.toolResults[0]
      ?.output as SearchSourcesToolOutputLogMeta;
    expect(searchSourcesOutput.output.preview.startsWith("\n## Retrieval Result"))
      .toBe(true);
    expect(searchSourcesOutput.output.preview.endsWith("\n  ")).toBe(true);
    expect(searchSourcesOutput.output.preview).toContain("## Retrieval Result");
    expect(searchSourcesOutput.output.preview).toContain("\n\n## Evidence");
    expect(searchSourcesOutput.output.preview).toContain(
      "Query: 冯荣洲 身份证 ID card",
    );
    expect(searchSourcesOutput.output.preview).toContain(
      "[media asset URL hidden]",
    );
    expect(searchSourcesOutput.output.preview).toContain(
      fullStepToolOutputMarker,
    );
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
              output: "## Evidence\nMatched image evidence.",
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
    expect(prompt).toContain("Use GitHub-flavored Markdown when it improves readability");
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
    expect(prompt).toContain("Never output JSON metadata blocks");
    expect(prompt).toContain("Never mention asset_id, assetUrl");
    expect(prompt).toContain("do not transcribe personal details");
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
    expect(prompt).toContain("Make a second searchSources call")
    expect(prompt).toContain("readRetrievedChunk")
    expect(prompt).toContain("markdown output gives guidance")
    expect(prompt).toContain("Read IDs")
    expect(prompt).toContain("image or text+image search")
    expect(prompt).toContain("remote index")
    expect(prompt).toContain("person or section but not an image asset")
    expect(prompt).toContain("Do not paste raw prior messages")
    expect(prompt).toContain("身份证")
    expect(prompt).toContain("For image requests, search visual content directly")
    expect(prompt).toContain("Never output JSON metadata blocks")
    expect(prompt).toContain("Use GitHub-flavored Markdown when it improves readability")
    expect(prompt).toContain("do not transcribe personal details")
    expect(prompt).not.toContain("targetContent maps")
    expect(prompt).not.toContain("Read the tool output fields")
    expect(prompt).not.toContain("intent=overview")
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
    readonly inputSchema: {
      readonly safeParse: (value: unknown) => { readonly success: boolean }
    }
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
  readonly output: AgentLoopLogPreviewMeta
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

function getTestModelMessagesCharLength(
  messages: readonly ModelMessage[],
): number {
  return messages.reduce(
    (totalLength, message): number =>
      totalLength + getTestUnknownTextLength(message.content),
    0,
  )
}

function getTestUnknownTextLength(value: unknown): number {
  if (typeof value === "string") return value.length
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (totalLength, nestedValue): number =>
        totalLength + getTestUnknownTextLength(nestedValue),
      0,
    )
  }
  if (!value || typeof value !== "object") return 0

  return Object.values(value as Record<string, unknown>).reduce<number>(
    (totalLength, nestedValue): number =>
      totalLength + getTestUnknownTextLength(nestedValue),
    0,
  )
}

function getSearchSourcesTargetContentSchema(
  tool: CapturedAgentTools["searchSources"],
): CapturedZodSchema {
  const shape = tool.inputSchema._def?.shape
  const fields = typeof shape === "function" ? shape() : shape
  if (!fields) {
    throw new Error("searchSources input schema should expose fields.")
  }

  const targetContentSchema = fields.targetContent
  if (!targetContentSchema) {
    throw new Error("searchSources input schema should include targetContent.")
  }

  return targetContentSchema
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
