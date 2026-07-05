import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { ToolLoopAgent } from "ai"
import type { HarnessRunResult } from "@/agent-harness"

import {
  answerQuestionWithRetrieval,
  generateAgenticOutputManifest,
  parseChatRequestBody,
  type SearchSources,
} from "."
import type {
  HardenableRetrievalResult,
  HardenMediaAssetUrlsInput,
} from "./media-asset-hardening"
import type { Source } from "@/infrastructure/db/schema"
import type { ChatArtifactView } from "@/domains/chat/types"

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
        excludedSourceIds: ["source_2", "knowhere-doc:default:doc_remote"],
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
      excludeDocumentIds: ["doc_excluded", "doc_remote"],
    });
    expect(generateAnswer).toHaveBeenCalledWith({
      question: "What does the document say?",
      messages: [],
      sources,
      excludedSourceIds: ["source_2", "knowhere-doc:default:doc_remote"],
      searchSources: expect.any(Function),
    });
    expect(answer).toEqual({
      answer: "The answer is grounded.",
      citations: [result],
      artifacts: [],
    });
  });

  it("does not carry no-evidence metadata from default into a successful legacy namespace result", async () => {
    const legacyResult = makeRetrievalResult({
      source: {
        documentId: "doc_legacy",
        sourceFileName: "legacy.pdf",
        sectionPath: "Overview",
      },
    });
    const retrieval = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          results: [],
          evidenceText: null,
          referencedChunks: [],
          namespace: "default",
          query: "legacy document answer",
          routerUsed: "workflow_single_step",
          answerText: null,
          stopReason: "not_found",
          failureReason: "No relevant evidence found.",
        })
        .mockResolvedValueOnce({
          results: [legacyResult],
          evidenceText: "Legacy namespace evidence",
          referencedChunks: [],
          namespace: "notebook-legacy",
          query: "legacy document answer",
          routerUsed: "workflow_single_step",
          answerText: null,
          stopReason: "answer_done",
          failureReason: null,
        }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      const response = await searchSources({ query: "legacy document answer" });
      expect(response).toMatchObject({
        namespace: "default,notebook-legacy",
        stopReason: "answer_done",
        failureReason: null,
        results: [legacyResult],
        evidenceText: "Legacy namespace evidence",
      });
      return makeHarnessRunResult("The legacy answer is grounded.");
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the legacy document say?",
        namespace: "notebook-legacy",
        namespaces: ["default", "notebook-legacy"],
        sources: [
          makeSource({
            title: "legacy.pdf",
            knowhereDocumentId: "doc_legacy",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(retrieval.query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ namespace: "default" }),
    );
    expect(retrieval.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ namespace: "notebook-legacy" }),
    );
    expect(answer).toEqual({
      answer: "The legacy answer is grounded.",
      citations: [legacyResult],
      artifacts: [],
    });
  });

  it("bounds merged retrieval evidence before passing it to the answer agent", async () => {
    const defaultResults = Array.from({ length: 40 }, (_, index) =>
      makeRetrievalResult({
        content: `Default namespace result ${index + 1}`,
        source: {
          documentId: `doc_default_${index + 1}`,
          sourceFileName: "default.pdf",
          sectionPath: `Default ${index + 1}`,
        },
      }),
    );
    const workspaceResults = Array.from({ length: 40 }, (_, index) =>
      makeRetrievalResult({
        content: `Workspace result ${index + 1}`,
        source: {
          documentId: `doc_workspace_${index + 1}`,
          sourceFileName: "workspace.pdf",
          sectionPath: `Workspace ${index + 1}`,
        },
      }),
    );
    const referencedChunks = Array.from({ length: 40 }, (_, index) => ({
      chunkId: `chunk_${index + 1}`,
      documentId: `doc_reference_${index + 1}`,
      chunkType: "text" as const,
      sectionPath: `Reference ${index + 1}`,
    }));
    const retrieval = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          results: defaultResults,
          evidenceText: "Default evidence",
          referencedChunks,
          namespace: "default",
          query: "large response",
          routerUsed: "workflow_single_step",
          answerText: null,
          stopReason: "answer_done",
          failureReason: null,
        })
        .mockResolvedValueOnce({
          results: workspaceResults,
          evidenceText: "Workspace evidence",
          referencedChunks,
          namespace: "notebook-workspace",
          query: "large response",
          routerUsed: "workflow_single_step",
          answerText: null,
          stopReason: "answer_done",
          failureReason: null,
        }),
    };
    const generateAnswer = vi.fn(
      async ({ searchSources }: { searchSources: SearchSources }) => {
        const response = await searchSources({
          query: "large response",
          topK: 3,
        });
        expect(response.results).toHaveLength(6);
        expect(response.referencedChunks).toHaveLength(6);
        expect(response.results.map((result) => result.content)).toEqual(
          [
            ...defaultResults.slice(0, 3),
            ...workspaceResults.slice(0, 3),
          ].map((result) => result.content),
        );
        return makeHarnessRunResult("The answer is grounded.");
      },
    );

    await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the document say?",
        namespace: "notebook-workspace",
        namespaces: ["default", "notebook-workspace"],
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );
  });

  it("does not hide a failed namespace query behind an empty namespace result", async () => {
    const retrievalError = new Error("Legacy namespace query failed.");
    const retrieval = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          results: [],
          evidenceText: null,
          referencedChunks: [],
          namespace: "default",
          query: "legacy document answer",
          routerUsed: "workflow_single_step",
          answerText: null,
          stopReason: "not_found",
          failureReason: "No relevant evidence found.",
        })
        .mockRejectedValueOnce(retrievalError),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "legacy document answer" });
      return makeHarnessRunResult("This should not be used.");
    });

    await expect(
      Effect.runPromise(
        answerQuestionWithRetrieval({
          question: "What does the legacy document say?",
          namespace: "notebook-legacy",
          namespaces: ["default", "notebook-legacy"],
          sources: [
            makeSource({
              title: "legacy.pdf",
              knowhereDocumentId: "doc_legacy",
            }),
          ],
          excludedSourceIds: [],
          retrieval,
          generateAnswer,
          messages: [],
        }),
      ),
    ).rejects.toThrow();
    expect(retrieval.query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ namespace: "default" }),
    );
    expect(retrieval.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ namespace: "notebook-legacy" }),
    );
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
        results: [
          result,
          ...Array.from({ length: 30 }, (_, index) =>
            makeRetrievalResult({
              content: `extra result ${index + 1}`,
            }),
          ),
        ],
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
          ...Array.from({ length: 30 }, (_, index) => ({
            chunkId: `chunk_extra_${index + 1}`,
            documentId: "doc_identity",
            chunkType: "text" as const,
            sectionPath: `Extra referenced chunk ${index + 1}`,
          })),
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
      resultCount: 31,
      referencedChunkCount: 31,
    });
    expect(response.results).toHaveLength(20);
    expect(response.referencedChunks).toHaveLength(20);
    expect(response.results[0]).toMatchObject({ chunkType: "image" });
    expect(response.referencedChunks[0]).toMatchObject({ chunkType: "image" });
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
    const upstreamAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/image-9-Night%20Rocket%20Launch.jpg?AWSAccessKeyId=test";
    const result = makeRetrievalResult({
      chunkType: "image",
      assetUrl: upstreamAssetUrl,
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
      return makeHarnessRunResult(`Use this launch photo. ${upstreamAssetUrl}`);
    });
    const hardenChatAssetUrl = vi
      .fn()
      .mockResolvedValue(
        "https://blob.example/images/image-9-Night%20Rocket%20Launch.jpg",
      );

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
        hardenChatAssetUrl,
        messages: [],
      }),
    );

    expect(hardenChatAssetUrl).toHaveBeenCalledWith({
      source: expect.objectContaining({ id: "source_spacex" }),
      sourcePath: "images/image-9-Night Rocket Launch.jpg",
      assetUrl: upstreamAssetUrl,
    });
    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "SpaceX rocket photos",
      topK: 8,
      useAgentic: true,
      dataType: 3,
    });
    expect(answer.answer).toBe("Use this launch photo.");
    expect(answer.answer).not.toContain("knowhere-storage.example");
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

  it("hardens citation and artifact asset URLs before returning the answer", async () => {
    const rawAssetUrl =
      "https://knowhere-storage.example/results/job_1/images/id-front.jpg?AWSAccessKeyId=test";
    const hardenedAssetUrl =
      "https://blob.example/workspaces/workspace_1/chat-assets/source-source_identity/id-front.jpg";
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [
          makeRetrievalResult({
            chunkType: "image",
            assetUrl: rawAssetUrl,
            source: {
              documentId: "doc_identity",
              sourceFileName: "document-generated.pdf",
              sectionPath: "images/id-front.jpg",
            },
          }),
        ],
        evidenceText: "Identity image evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "identity front image",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({
        query: "identity front image",
        targetContent: "image",
      });
      return {
        manifest: {
          text: `Use this image. ${rawAssetUrl}`,
          citations: [],
          artifacts: [
            {
              type: "image",
              ref: "asset:r1:result:1",
              display: true,
              reason: "Requested identity image",
            },
          ],
          unresolved: [],
        },
        trace: {
          ...makeHarnessRunResult("").trace,
          finalized: true,
          ledger: {
            retrievalCount: 1,
            evidenceText: ["Identity image evidence."],
            stopReasons: [],
            failureReasons: [],
            decisionTraces: [],
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.9,
                assetUrl: rawAssetUrl,
                assetRef: "asset:r1:result:1",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "images/id-front.jpg",
                },
              },
            ],
            assets: [
              {
                ref: "asset:r1:result:1",
                chunkRef: "r1:result:1",
                type: "image",
                assetUrl: rawAssetUrl,
                label: "document-generated.pdf / id front / image",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "images/id-front.jpg",
                },
              },
            ],
          },
        },
      } satisfies HarnessRunResult;
    });
    const hardenMediaAssetUrls = vi.fn(
      async ({
        results,
        artifacts,
      }: HardenMediaAssetUrlsInput): Promise<{
        results: RetrievalResult[]
        artifacts?: ChatArtifactView[]
      }> => ({
        results: results.map((result): RetrievalResult => ({
          ...result,
          assetUrl:
            result.assetUrl === rawAssetUrl ? hardenedAssetUrl : result.assetUrl,
        })),
        artifacts: artifacts?.map((artifact): ChatArtifactView => ({
          ...artifact,
          assetUrl:
            artifact.assetUrl === rawAssetUrl
              ? hardenedAssetUrl
              : artifact.assetUrl,
          citation: artifact.citation
            ? {
                ...artifact.citation,
                assetUrl:
                  artifact.citation.assetUrl === rawAssetUrl
                    ? hardenedAssetUrl
                    : artifact.citation.assetUrl,
              }
            : undefined,
        })),
      }),
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Show me the identity image.",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_identity",
            title: "identity.pdf",
            knowhereDocumentId: "doc_identity",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        hardenMediaAssetUrls,
        messages: [],
      }),
    );

    expect(hardenMediaAssetUrls).toHaveBeenCalledWith({
      results: [
        expect.objectContaining({
          assetUrl: rawAssetUrl,
          source: expect.objectContaining({
            sourceFileName: "identity.pdf",
          }),
        }),
      ],
      artifacts: [
        expect.objectContaining({
          assetUrl: rawAssetUrl,
          citation: expect.objectContaining({ assetUrl: rawAssetUrl }),
        }),
      ],
    });
    expect(answer.answer).toBe("Use this image.");
    expect(answer.answer).not.toContain("knowhere-storage.example");
    expect(answer.citations.map((citation) => citation.assetUrl)).toEqual([
      hardenedAssetUrl,
    ]);
    expect(answer.artifacts?.map((artifact) => artifact.assetUrl)).toEqual([
      hardenedAssetUrl,
    ]);
    expect(answer.artifacts?.[0]?.citation?.assetUrl).toBe(hardenedAssetUrl);
  });

  it("hardens page citation asset URLs before returning citations", async () => {
    const rawPageAssetUrl =
      "https://knowhere-storage.example/results/job_1/page_citation_assets/page-4.png?AWSAccessKeyId=test";
    const storedPageAssetUrl =
      "https://blob.example/workspaces/workspace_1/sources/source_pages/parsed-result/page_citation_assets/page-4.png";
    const hardenedPageAssetUrl =
      "https://blob.example/workspaces/workspace_1/chat-assets/source-source_pages/page-4.png";
    const result = makeRetrievalResult({
      chunkType: "page",
      metadata: {
        pageNums: [4],
        pageAssets: [
          {
            pageNum: 4,
            artifactRef: "page_citation_assets/page-4.png",
            assetUrl: rawPageAssetUrl,
            contentType: "image/png",
          },
        ],
      },
      source: {
        documentId: "doc_pages",
        sourceFileName: "document-generated.pdf",
        sectionPath: "Page 4",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Page four evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "page four evidence",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "page four evidence" });
      return makeHarnessRunResult(`This page has the answer. ${storedPageAssetUrl}`);
    });
    const hardenMediaAssetUrls = vi.fn(
      async ({
        results,
        artifacts,
      }: HardenMediaAssetUrlsInput): Promise<{
        results: HardenableRetrievalResult[]
        artifacts?: ChatArtifactView[]
      }> => ({
        results: results.map(
          (candidate): HardenableRetrievalResult => ({
            ...candidate,
            pageCitationAssetUrl:
              candidate.pageCitationAssetUrl === rawPageAssetUrl
                ? hardenedPageAssetUrl
                : candidate.pageCitationAssetUrl === storedPageAssetUrl
                ? hardenedPageAssetUrl
                : candidate.pageCitationAssetUrl,
          }),
        ),
        ...(artifacts ? { artifacts: [...artifacts] } : {}),
      }),
    );
    const hardenChatAssetUrl = vi.fn().mockResolvedValue(storedPageAssetUrl);

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What is on page four?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_pages",
            title: "deck.pdf",
            knowhereDocumentId: "doc_pages",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        hardenMediaAssetUrls,
        hardenChatAssetUrl,
        messages: [],
      }),
    );

    expect(hardenChatAssetUrl).toHaveBeenCalledWith({
      source: expect.objectContaining({ id: "source_pages" }),
      sourcePath: "page_citation_assets/page-4.png",
      assetUrl: rawPageAssetUrl,
      contentType: "image/png",
    });
    expect(hardenMediaAssetUrls).toHaveBeenCalledWith({
      results: [
        expect.objectContaining({
          pageCitationAssetUrl: storedPageAssetUrl,
          source: expect.objectContaining({
            sourceFileName: "deck.pdf",
          }),
        }),
      ],
      artifacts: undefined,
    });
    expect(answer.answer).toBe("This page has the answer.");
    expect(answer.answer).not.toContain("knowhere-storage.example");
    expect(answer.citations).toEqual([
      expect.objectContaining({
        chunkType: "page",
        pageCitationAssetUrl: hardenedPageAssetUrl,
        source: expect.objectContaining({
          sourceFileName: "deck.pdf",
        }),
      }),
    ]);
    expect(answer.citations[0]?.pageCitationAssetUrl).not.toBe(rawPageAssetUrl);
  });

  it("hardens page citation asset URLs from referenced chunk metadata", async () => {
    const rawPageAssetUrl =
      "https://knowhere-storage.example/results/job_1/page_citation_assets/page-6.png?AWSAccessKeyId=test";
    const storedPageAssetUrl =
      "https://blob.example/workspaces/workspace_1/sources/source_pages/parsed-result/page_citation_assets/page-6.png";
    const hardenedPageAssetUrl =
      "https://blob.example/workspaces/workspace_1/chat-assets/source-source_pages/page-6.png";
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [],
        evidenceText: "Page six evidence.",
        referencedChunks: [
          {
            chunkId: "chunk_page_6",
            documentId: "doc_pages",
            chunkType: "page",
            sectionPath: "Page 6",
            filePath: null,
            jobId: "job_1",
            assetUrl: rawPageAssetUrl,
            metadata: {
              pageNums: [6],
              pageAssets: [
                {
                  pageNum: 6,
                  artifactRef: "page_citation_assets/page-6.png",
                  assetUrl: rawPageAssetUrl,
                  contentType: "image/png",
                },
              ],
            },
          },
        ],
        namespace: "notebook-workspace",
        query: "page six evidence",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "page six evidence" });
      return makeHarnessRunResult("This page has referenced evidence.");
    });
    const hardenMediaAssetUrls = vi.fn(
      async ({
        results,
        artifacts,
      }: HardenMediaAssetUrlsInput): Promise<{
        results: HardenableRetrievalResult[]
        artifacts?: ChatArtifactView[]
      }> => ({
        results: results.map(
          (candidate): HardenableRetrievalResult => ({
            ...candidate,
            pageCitationAssetUrl:
              candidate.pageCitationAssetUrl === rawPageAssetUrl
                ? hardenedPageAssetUrl
                : candidate.pageCitationAssetUrl === storedPageAssetUrl
                ? hardenedPageAssetUrl
                : candidate.pageCitationAssetUrl,
          }),
        ),
        ...(artifacts ? { artifacts: [...artifacts] } : {}),
      }),
    );
    const hardenChatAssetUrl = vi.fn().mockResolvedValue(storedPageAssetUrl);

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What is on page six?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_pages",
            title: "deck.pdf",
            knowhereDocumentId: "doc_pages",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        hardenMediaAssetUrls,
        hardenChatAssetUrl,
        messages: [],
      }),
    );

    expect(hardenChatAssetUrl).toHaveBeenCalledWith({
      source: expect.objectContaining({ id: "source_pages" }),
      sourcePath: "page_citation_assets/page-6.png",
      assetUrl: rawPageAssetUrl,
      contentType: "image/png",
    });
    expect(hardenMediaAssetUrls).toHaveBeenCalledWith({
      results: [
        expect.objectContaining({
          metadata: expect.objectContaining({
            pageAssets: [
              expect.objectContaining({
                assetUrl: rawPageAssetUrl,
              }),
            ],
          }),
          pageCitationAssetUrl: storedPageAssetUrl,
        }),
      ],
      artifacts: undefined,
    });
    expect(answer.citations[0]?.pageCitationAssetUrl).toBe(hardenedPageAssetUrl);
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
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.9,
                assetUrl: frontAssetUrl,
                assetRef: "asset:r1:result:1",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "身份证正面",
                },
              },
              {
                ref: "r1:result:2",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.88,
                assetUrl: backAssetUrl,
                assetRef: "asset:r1:result:2",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "身份证反面",
                },
              },
              {
                ref: "r1:result:3",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.7,
                assetUrl: extraAssetUrl,
                assetRef: "asset:r1:result:3",
                source: {
                  documentId: "doc_identity",
                  sourceFileName: "document-generated.pdf",
                  sectionPath: "营业执照",
                },
              },
            ],
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
          finalized: true,
          priorTurnReads: [],
          toolCalls: [],
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
    expect(answer.citations.map((citation) => citation.assetUrl)).toEqual([
      frontAssetUrl,
      backAssetUrl,
    ]);
  });

  it("returns a safe fallback when the harness still has validation errors", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [makeRetrievalResult()],
        evidenceText: "Grounding content",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "What changed?",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "What changed?" });
      return {
        ...makeHarnessRunResult("This invalid answer should not ship."),
        trace: {
          ...makeHarnessRunResult("").trace,
          finalized: false,
          validationErrors: [
            "Agent must call finalize to produce the output manifest.",
          ],
        },
      };
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What changed?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer).toEqual({
      answer:
        "I couldn't safely finish that response because the agent output did not pass Notebook's validation checks. Please try again.",
      citations: [],
      artifacts: [],
    });
  });

  it("keeps image-only harness output instead of treating it as no results", async () => {
    const assetUrl = "https://blob.example/images/diagram.png";
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [
          makeRetrievalResult({
            content: "",
            chunkType: "image",
            assetUrl,
            source: {
              documentId: "doc_diagram",
              sourceFileName: "generated.pdf",
              sectionPath: "Diagram",
            },
          }),
        ],
        evidenceText: "Diagram candidate.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "diagram",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "diagram", targetContent: "image" });
      return {
        manifest: {
          text: "",
          citations: [],
          artifacts: [
            {
              type: "image",
              ref: "asset:r1:result:1",
              display: true,
              reason: "Requested diagram",
            },
          ],
          unresolved: [],
        },
        trace: {
          ...makeHarnessRunResult("").trace,
          finalized: true,
          priorTurnReads: [],
          toolCalls: [],
          ledger: {
            retrievalCount: 1,
            evidenceText: ["Diagram candidate."],
            stopReasons: [],
            failureReasons: [],
            decisionTraces: [],
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.9,
                assetUrl,
                assetRef: "asset:r1:result:1",
                source: {
                  documentId: "doc_diagram",
                  sourceFileName: "generated.pdf",
                  sectionPath: "Diagram",
                },
              },
            ],
            assets: [
              {
                ref: "asset:r1:result:1",
                chunkRef: "r1:result:1",
                type: "image",
                assetUrl,
                label: "generated.pdf / Diagram / image",
                source: {
                  documentId: "doc_diagram",
                  sourceFileName: "generated.pdf",
                  sectionPath: "Diagram",
                },
              },
            ],
          },
        },
      } satisfies HarnessRunResult;
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Show me the diagram.",
        namespace: "notebook-workspace",
        sources: [
          makeSource({ title: "diagram.pdf", knowhereDocumentId: "doc_diagram" }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.answer).not.toBe("I couldn't find that in your sources.");
    expect(answer.artifacts?.map((artifact) => artifact.assetUrl)).toEqual([
      assetUrl,
    ]);
    expect(answer.citations.map((citation) => citation.assetUrl)).toEqual([
      assetUrl,
    ]);
  });

  it("returns source-backed derived table artifacts from the harness manifest", async () => {
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [
          makeRetrievalResult({
            content: "Plan A costs $10M and takes 6 months.",
            source: {
              documentId: "doc_plan_a",
              sourceFileName: "plan-a.pdf",
              sectionPath: "Cost",
            },
          }),
          makeRetrievalResult({
            content: "Plan B costs $8M and takes 9 months.",
            source: {
              documentId: "doc_plan_b",
              sourceFileName: "plan-b.pdf",
              sectionPath: "Cost",
            },
          }),
        ],
        evidenceText: "Plan comparison evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "compare plan costs timelines",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "compare plan costs timelines" });
      return {
        manifest: {
          text: "I organized the comparison into a table.",
          citations: [],
          artifacts: [
            {
              type: "derived_table",
              ref: "derived:table:plans",
              title: "Plan comparison",
              columns: ["Plan", "Cost", "Timeline"],
              rows: [
                ["Plan A", "$10M", "6 months"],
                ["Plan B", "$8M", "9 months"],
              ],
              sourceRefs: ["r1:result:1", "r1:result:2"],
              display: true,
              reason: "The user asked for a comparison table.",
            },
          ],
          unresolved: [],
        },
        trace: {
          ...makeHarnessRunResult("").trace,
          finalized: true,
          ledger: {
            retrievalCount: 1,
            evidenceText: ["Plan comparison evidence."],
            stopReasons: [],
            failureReasons: [],
            decisionTraces: [],
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "Plan A costs $10M and takes 6 months.",
                contentPreview: "Plan A costs $10M and takes 6 months.",
                chunkType: "text",
                score: 0.9,
                source: {
                  documentId: "doc_plan_a",
                  sourceFileName: "plan-a.pdf",
                  sectionPath: "Cost",
                },
              },
              {
                ref: "r1:result:2",
                kind: "result",
                content: "Plan B costs $8M and takes 9 months.",
                contentPreview: "Plan B costs $8M and takes 9 months.",
                chunkType: "text",
                score: 0.88,
                source: {
                  documentId: "doc_plan_b",
                  sourceFileName: "plan-b.pdf",
                  sectionPath: "Cost",
                },
              },
            ],
            assets: [],
          },
        },
      } satisfies HarnessRunResult;
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Compare the plans in a table.",
        namespace: "notebook-workspace",
        sources: [
          makeSource({ title: "Plan A.pdf", knowhereDocumentId: "doc_plan_a" }),
          makeSource({
            id: "source_plan_b",
            title: "Plan B.pdf",
            knowhereDocumentId: "doc_plan_b",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.artifacts).toEqual([
      {
        type: "derived_table",
        ref: "derived:table:plans",
        title: "Plan comparison",
        columns: ["Plan", "Cost", "Timeline"],
        rows: [
          ["Plan A", "$10M", "6 months"],
          ["Plan B", "$8M", "9 months"],
        ],
        sourceRefs: ["r1:result:1", "r1:result:2"],
        display: true,
        reason: "The user asked for a comparison table.",
      },
    ]);
    expect(answer.citations.map((citation) => citation.source.sourceFileName)).toEqual(
      ["Plan A.pdf", "Plan B.pdf"],
    );
  });

  it("does not turn evidence-only image filenames into image citations", async () => {
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
    const hardenChatAssetUrl = vi.fn().mockResolvedValue(null);
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
        hardenChatAssetUrl,
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
    expect(imageCitations).toEqual([]);
    expect(hardenChatAssetUrl).not.toHaveBeenCalled();
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
      artifacts: [],
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
    failureStage: null,
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
      finalized: true,
      priorTurnReads: [],
      toolCalls: [],
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
