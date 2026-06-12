import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { ToolLoopAgent } from "ai"
import type { HarnessRunResult } from "@/agent-harness"

import {
  answerQuestionWithRetrieval,
  generateAgenticOutputManifest,
  parseChatRequestBody,
} from "."
import type { Source } from "@/infrastructure/db/schema"

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
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
      return makeHarnessRunResult("The answer is grounded.");
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
      return makeHarnessRunResult("Matched identity card image.");
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
      return makeHarnessRunResult(
        "Revenue improved [Source 1: revenue growth]. Margins expanded [Source 2: margin expansion].",
      );
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
      return makeHarnessRunResult(
        "Tesla invested in xAI [Source 1: xAI investment].",
      );
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
      return makeHarnessRunResult(
        "Use this launch photo. https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
      );
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

  it("returns only harness-selected artifacts when retrieval has extra media candidates", async () => {
    const frontAssetUrl = "https://blob.example/images/id-front.jpg";
    const backAssetUrl = "https://blob.example/images/id-back.jpg";
    const extraAssetUrl = "https://blob.example/images/extra.jpg";
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [
          makeRetrievalResult({
            chunkType: "image",
            assetUrl: frontAssetUrl,
            source: {
              documentId: "doc_identity",
              sourceFileName: "document-generated.pdf",
              sectionPath: "身份证正面",
            },
          }),
          makeRetrievalResult({
            chunkType: "image",
            assetUrl: backAssetUrl,
            source: {
              documentId: "doc_identity",
              sourceFileName: "document-generated.pdf",
              sectionPath: "身份证反面",
            },
          }),
          makeRetrievalResult({
            chunkType: "image",
            assetUrl: extraAssetUrl,
            source: {
              documentId: "doc_identity",
              sourceFileName: "document-generated.pdf",
              sectionPath: "营业执照",
            },
          }),
        ],
        evidenceText: "Identity image candidates.",
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
      });
      const harnessResult: HarnessRunResult = {
        manifest: {
          text: "已找到相关身份证图片，见下方图片。",
          citations: [],
          artifacts: [
            {
              type: "image",
              ref: "asset:r1:result:1",
              display: true,
              reason: "身份证正面",
            },
            {
              type: "image",
              ref: "asset:r1:result:2",
              display: true,
              reason: "身份证反面",
            },
            {
              type: "image",
              ref: "asset:r1:result:3",
              display: true,
              reason: "多余候选图片",
            },
          ],
          unresolved: [],
        },
        trace: {
          ledger: {
            retrievalCount: 1,
            evidenceText: ["Identity image candidates."],
            stopReasons: [],
            failureReasons: [],
            decisionTraces: [],
            chunks: [],
            assets: [
              {
                ref: "asset:r1:result:1",
                chunkRef: "r1:result:1",
                type: "image",
                assetUrl: frontAssetUrl,
                label: "document-generated.pdf / 身份证正面 / image",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "身份证正面",
                },
              },
              {
                ref: "asset:r1:result:2",
                chunkRef: "r1:result:2",
                type: "image",
                assetUrl: backAssetUrl,
                label: "document-generated.pdf / 身份证反面 / image",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "身份证反面",
                },
              },
              {
                ref: "asset:r1:result:3",
                chunkRef: "r1:result:3",
                type: "image",
                assetUrl: extraAssetUrl,
                label: "document-generated.pdf / 营业执照 / image",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "营业执照",
                },
              },
            ],
          },
          validationErrors: [],
          revisionsUsed: 0,
          intent: {
            task: "show_media",
            dependsOnPreviousTurn: false,
            retrievalNeeded: "yes",
            targetModalities: ["image"],
            constraints: { desiredCount: 2, maxCount: 2 },
            groundingPolicy: "must_use_sources",
          },
          contextPolicy: {
            carryHistory: "none",
            reason: "The current turn is self-contained.",
            activePriorTurnIds: [],
          },
        },
      };
      return harnessResult;
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "请只返回冯荣洲的 2 张身份证图片",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            title: "商务标文件.pdf",
            knowhereDocumentId: "doc_identity",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.artifacts?.map((artifact) => artifact.assetUrl)).toEqual([
      frontAssetUrl,
      backAssetUrl,
    ]);
    expect(answer.artifacts?.map((artifact) => artifact.citation?.source)).toEqual(
      [
        {
          documentId: "doc_identity",
          sourceFileName: "商务标文件.pdf",
          sectionPath: "身份证正面",
        },
        {
          documentId: "doc_identity",
          sourceFileName: "商务标文件.pdf",
          sectionPath: "身份证反面",
        },
      ],
    );
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
      return makeHarnessRunResult("这里是相关身份证明图片。");
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
    });
    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "公民身份证明 图片",
      topK: 8,
      useAgentic: true,
      dataType: 3,
    });
    const imageCitations = answer.citations.filter(
      (citation) => citation.assetUrl,
    )
    expect(imageCitations.map((citation) => citation.assetUrl)).toEqual([
      "https://blob.example/images/image-6-id-front.jpg",
      "https://blob.example/images/image-7-id-back.jpg",
    ]);
    expect(imageCitations.map((citation) => citation.chunkType)).toEqual([
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
      return makeHarnessRunResult("I couldn't find that in your sources.");
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
      return makeHarnessRunResult("Energy storage grew.");
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
      return makeHarnessRunResult("Energy storage grew.");
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
      return makeHarnessRunResult("Here is the launch image.");
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

describe("generateAgenticOutputManifest", () => {
  it("runs the outer harness workflow around Knowhere retrieval", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    let capturedGenerateInput:
      | Parameters<ToolLoopAgent["generate"]>[0]
      | undefined;
    vi.spyOn(ToolLoopAgent.prototype, "generate").mockImplementation(
      async function mockGenerate(
        this: ToolLoopAgent,
        input: Parameters<ToolLoopAgent["generate"]>[0],
      ): ReturnType<ToolLoopAgent["generate"]> {
        capturedGenerateInput = input;
        const tools = this.tools as unknown as Record<
          string,
          { execute: (input: unknown) => Promise<unknown> }
        >;

        await tools.declareIntent?.execute({
          task: "show_media",
          dependsOnPreviousTurn: false,
          retrievalNeeded: "yes",
          targetModalities: ["text", "image"],
          constraints: { desiredCount: 2, maxCount: 2 },
          groundingPolicy: "must_use_sources",
        });
        await tools.setContextPolicy?.execute({
          carryHistory: "none",
          reason: "The current request is self-contained.",
          activePriorTurnIds: [],
        });
        await tools.retrieve?.execute({
          query: "冯荣洲 身份证 图片",
          modalities: ["text", "image"],
          topK: 2,
          purpose: "Find exactly the requested identity-card images.",
        });
        await tools.finalize?.execute({
          text: "已找到相关身份证图片，见下方图片。",
          citations: [
            {
              ref: "r1:result:1",
              label: "商务标文件.pdf / 身份证正面",
              source: {
                documentId: "doc_identity",
                sourceFileName: "商务标文件.pdf",
                sectionPath: "身份证正面",
              },
            },
          ],
          artifacts: [
            {
              type: "image",
              ref: "asset:r1:result:1",
              display: true,
              reason: "身份证正面",
            },
          ],
          unresolved: [],
        });

        return {
          text: "This freeform text should be ignored.",
        } as Awaited<ReturnType<ToolLoopAgent["generate"]>>;
      },
    );
    const searchSources = vi.fn().mockResolvedValue({
      results: [
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: "https://blob.example/images/id-front.jpg",
          source: {
            documentId: "doc_identity",
            sourceFileName: "document-generated.pdf",
            sectionPath: "身份证正面",
          },
        }),
      ],
      evidenceText: "Identity image evidence.",
      referencedChunks: [],
      namespace: "notebook-workspace",
      query: "冯荣洲 身份证 图片",
      routerUsed: "workflow_single_step",
      chunkReferences: [],
      answerText: null,
      stopReason: "answer_done",
      failureReason: null,
    });

    const result = await generateAgenticOutputManifest({
      question: "请只返回冯荣洲的 2 张身份证图片",
      messages: [
        {
          role: "assistant",
          content: "上一轮是完全不同的税务问题。",
          citations: [
            {
              chunkType: "text",
              score: 0.9,
              source: {
                documentId: "doc_tax",
                sourceFileName: "tax.pdf",
                sectionPath: "deadline",
              },
            },
          ],
        },
      ],
      sources: [
        makeSource({
          title: "商务标文件.pdf",
          knowhereDocumentId: "doc_identity",
        }),
      ],
      excludedSourceIds: [],
      searchSources,
    });

    expect(result.manifest.text).toBe("已找到相关身份证图片，见下方图片。");
    expect(result.trace.intent).toMatchObject({
      task: "show_media",
      constraints: { desiredCount: 2, maxCount: 2 },
    });
    expect(result.trace.contextPolicy).toMatchObject({
      carryHistory: "none",
    });
    expect(result.trace.validationErrors).toEqual([]);
    expect(searchSources).toHaveBeenCalledWith({
      query: "冯荣洲 身份证 图片",
      targetContent: "text_image",
      purpose: "Find exactly the requested identity-card images.",
      topK: 2,
      signalPaths: undefined,
      filterMode: undefined,
      threshold: undefined,
    });
    expect(JSON.stringify(capturedGenerateInput)).toContain("Recent turn index");
    expect(JSON.stringify(capturedGenerateInput)).toContain("tax.pdf / deadline");
  });

  it("self-corrects an over-budget manifest via a validation-feedback revision", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    let generateCallCount = 0;
    vi.spyOn(ToolLoopAgent.prototype, "generate").mockImplementation(
      async function mockGenerate(
        this: ToolLoopAgent,
      ): ReturnType<ToolLoopAgent["generate"]> {
        generateCallCount += 1;
        const tools = this.tools as unknown as Record<
          string,
          { execute: (input: unknown) => Promise<unknown> }
        >;

        if (generateCallCount === 1) {
          await tools.declareIntent?.execute({
            task: "show_media",
            dependsOnPreviousTurn: false,
            retrievalNeeded: "yes",
            targetModalities: ["image"],
            constraints: { desiredCount: 2, maxCount: 2 },
            groundingPolicy: "must_use_sources",
          });
          await tools.setContextPolicy?.execute({
            carryHistory: "none",
            reason: "Self-contained request.",
            activePriorTurnIds: [],
          });
          await tools.retrieve?.execute({
            query: "身份证 图片",
            modalities: ["image"],
            topK: 3,
            purpose: "Find requested identity images.",
          });
          await tools.finalize?.execute({
            text: "见下方图片。",
            citations: [{ ref: "r1:result:1", label: "id" }],
            artifacts: [1, 2, 3].map((index) => ({
              type: "image",
              ref: `asset:r1:result:${index}`,
              display: true,
              reason: "candidate",
            })),
            unresolved: [],
          });
        } else {
          await tools.finalize?.execute({
            text: "见下方图片。",
            citations: [{ ref: "r1:result:1", label: "id" }],
            artifacts: [1, 2].map((index) => ({
              type: "image",
              ref: `asset:r1:result:${index}`,
              display: true,
              reason: "selected",
            })),
            unresolved: [],
          });
        }

        return {
          text: "ignored",
          response: { messages: [] },
        } as unknown as Awaited<ReturnType<ToolLoopAgent["generate"]>>;
      },
    );

    const searchSources = vi.fn().mockResolvedValue({
      results: [1, 2, 3].map((index) =>
        makeRetrievalResult({
          chunkType: "image",
          assetUrl: `https://blob.example/images/id-${index}.jpg`,
          source: {
            documentId: "doc_identity",
            sourceFileName: "ids.pdf",
            sectionPath: `身份证 ${index}`,
          },
        }),
      ),
      evidenceText: "Identity image evidence.",
      referencedChunks: [],
      namespace: "notebook-workspace",
      query: "身份证 图片",
      routerUsed: "workflow_single_step",
      answerText: null,
      stopReason: "answer_done",
      failureReason: null,
    });

    const result = await generateAgenticOutputManifest({
      question: "只要 2 张身份证图片",
      messages: [],
      sources: [
        makeSource({ title: "ids.pdf", knowhereDocumentId: "doc_identity" }),
      ],
      excludedSourceIds: [],
      searchSources,
    });

    expect(generateCallCount).toBe(2);
    expect(result.trace.revisionsUsed).toBe(1);
    expect(result.trace.validationErrors).toEqual([]);
    expect(
      result.manifest.artifacts.filter((artifact) => artifact.display).length,
    ).toBe(2);
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

function makeHarnessRunResult(text: string): HarnessRunResult {
  return {
    manifest: {
      text,
      citations: [],
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
      validationErrors: [],
      revisionsUsed: 0,
    },
  };
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
