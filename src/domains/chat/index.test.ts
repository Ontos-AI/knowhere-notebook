import { afterEach, describe, expect, it, vi } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import Knowhere from "@ontos-ai/knowhere-sdk"
import type {
  Knowledge,
  RetrievalQueryParams,
  RetrievalQueryResponse,
  RetrievalResult,
} from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { ToolLoopAgent } from "ai"
import type { HarnessRunResult } from "@/agent-harness"

import {
  answerQuestionWithRetrieval,
  generateAgenticOutputManifest,
  parseChatRequestBody,
  type GenerateAnswer,
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
      knowhereTools: expect.any(Object),
    });
    expect(answer).toEqual({
      answer: "The answer is grounded.",
      citations: [],
      artifacts: [],
      agentTrace: {
        intentTask: "",
        toolCalls: [],
        referencedDocumentIds: [],
      },
    });
  });

  it("returns a slim Notebook TRACE and does not pass the Knowhere TRACE through", async () => {
    const generateAnswer = vi.fn(async () => {
      const result = makeHarnessRunResult("Grounded answer.");
      return {
        ...result,
        trace: {
          ...result.trace,
          intent: {
            task: "answer" as const,
            dependsOnPreviousTurn: false,
            retrievalNeeded: "yes" as const,
            targetModalities: ["text" as const],
            constraints: {},
            groundingPolicy: "must_use_sources" as const,
          },
          toolCalls: [
            {
              tool: "knowhere_search",
              ok: true,
              inputSummary: { query: "毛利率" },
              outputSummary: { ok: true },
              startedAt: "2026-09-20T00:00:00.000Z",
              durationMs: 10,
            },
          ],
          ledger: {
            ...result.trace.ledger,
            chunks: [
              makeEvidenceChunkFromRetrievalResult(
                "r1:result:1",
                makeRetrievalResult({
                  source: { documentId: "doc_1" },
                }),
              ),
            ],
            decisionTraces: [[{ agent: "agent_explore" }]],
          },
        },
      };
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "毛利率怎么算",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval: { query: vi.fn() },
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.agentTrace).toEqual({
      intentTask: "answer",
      toolCalls: [
        {
          tool: "knowhere_search",
          ok: true,
          summary: JSON.stringify({
            input: { query: "毛利率" },
            output: { ok: true },
          }),
        },
      ],
      referencedDocumentIds: ["doc_1"],
    });
    expect(JSON.stringify(answer.agentTrace)).not.toContain("agent_explore");
  });

  it("refuses knowhere search when the current folder has no documents", async () => {
    const retrieval = { query: vi.fn() };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await expect(searchSources({ query: "What is in this folder?" })).rejects.toThrow(
        "The current folder has no documents. Do not call knowhere_search.",
      );
      return makeHarnessRunResult("This folder has no documents.");
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "hello",
        namespace: "notebook-workspace",
        sources: [makeSource({ id: "source_elsewhere" })],
        excludedSourceIds: [],
        folderScopeSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(retrieval.query).not.toHaveBeenCalled();
    expect(generateAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ folderScopeSourceIds: [] }),
    );
    expect(answer.answer).toBe("This folder has no documents.");
  });

  it.each([true, false])("sends document scope through the installed SDK (agentic=%s)", async (useAgentic) => {
    const received: Record<string, unknown>[] = []
    const result = makeRetrievalResult({
      content: "Evidence from the allowed document.",
      source: { documentId: "doc_included", sourceFileName: "notes.txt", sectionPath: "Overview" },
    })
    const server = createServer((request, response) => {
      let body = ""
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => { body += chunk })
      request.on("end", () => {
        received.push(JSON.parse(body))
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          namespace: "default", query: "document question", router_used: "test_fixture",
          results: [{ content: result.content, chunk_type: "text", score: 1,
            source: { document_id: "doc_included", source_file_name: "notes.txt", section_path: "Overview" } }],
          referenced_chunks: [], evidence_text: result.content, answer_text: "",
        }))
      })
    })
    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Expected TCP address")
      const client = new Knowhere({ apiKey: "scope-test", baseURL: `http://127.0.0.1:${address.port}`, maxRetries: 0 })
      const scopes = [
        {},
        { includeDocumentIds: ["doc_included", "doc_other"] },
        { excludeDocumentIds: ["doc_other"] },
        { includeDocumentIds: ["doc_included", "doc_other"], excludeDocumentIds: ["doc_other"] },
        { includeDocumentIds: [] },
      ]
      const answer = await Effect.runPromise(answerQuestionWithRetrieval({
        question: "document question", namespace: "default", useAgentic,
        sources: [makeSource(), makeSource({ id: "source_other", knowhereDocumentId: "doc_other" })],
        excludedSourceIds: ["knowhere-doc:default:doc_user_excluded"],
        retrieval: client.retrieval,
        generateAnswer: async ({ knowhereTools }) => {
          if (!knowhereTools) throw new Error("Missing Knowhere tools")
          for (const scope of scopes) await knowhereTools.search({ query: "document question", ...scope })
          return makeCitedHarnessRunResult("Evidence [[cite:1]].", result)
        },
        messages: [],
      }))
      expect(received).toEqual(scopes.map((scope) => ({
        namespace: "default", query: "document question", top_k: 8, use_agentic: useAgentic, data_type: 1,
        ...(scope.includeDocumentIds !== undefined ? { include_document_ids: scope.includeDocumentIds } : {}),
        exclude_document_ids: ["doc_user_excluded", ...(scope.excludeDocumentIds ?? [])],
      })))
      expect(answer.answer).toBe("Evidence [[cite:1]].")
      expect(answer.citations).toHaveLength(1)
      expect(answer.citations[0]?.source.documentId).toBe("doc_included")
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve())
          server.closeAllConnections()
        })
      }
    }
  })

  it("rejects invented document IDs but accepts IDs discovered by a prior search", async () => {
    const result = makeRetrievalResult({ source: {
      documentId: "doc_discovered", sourceFileName: "named-document.pdf", sectionPath: "Overview",
    } })
    const retrieval = { query: vi.fn().mockResolvedValue({
      namespace: "default", query: "named document", routerUsed: "agent_explore",
      results: [result], referencedChunks: [], evidenceText: result.content, answerText: "",
    }) }
    await Effect.runPromise(answerQuestionWithRetrieval({
      question: "Only search the named document", namespace: "default",
      sources: [makeSource()], excludedSourceIds: [], retrieval, messages: [],
      generateAnswer: async ({ knowhereTools }) => {
        if (!knowhereTools) throw new Error("Missing Knowhere tools")
        await expect(knowhereTools.search({ query: "question", includeDocumentIds: ["named-document.pdf"] })).rejects.toThrow("unverified ID")
        await expect(knowhereTools.search({ query: "question", excludeDocumentIds: ["doc_invented"] })).rejects.toThrow("unverified ID")
        expect(retrieval.query).not.toHaveBeenCalled()
        await knowhereTools.search({ query: "Only search named-document.pdf" })
        await knowhereTools.search({ query: "question", includeDocumentIds: ["doc_discovered"] })
        expect(retrieval.query).toHaveBeenLastCalledWith(expect.objectContaining({ includeDocumentIds: ["doc_discovered"] }))
        return makeCitedHarnessRunResult("Evidence [[cite:1]].", result)
      },
    }))
  })

  it("does not create source chips from retrieval results when the manifest has no citations", async () => {
    const unrelatedResult = makeRetrievalResult({
      content: "Information hiding is unrelated to the requested source.",
      source: {
        documentId: "doc_information_hiding",
        sourceFileName: "information_hiding.pdf",
        sectionPath: "Root",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [unrelatedResult],
        evidenceText: "Information hiding evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "requested fact",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "requested fact" });
      return makeHarnessRunResult("The answer omits citations.");
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What does the selected source say?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer).toEqual({
      answer: "The answer omits citations.",
      citations: [],
      artifacts: [],
      agentTrace: {
        intentTask: "",
        toolCalls: [],
        referencedDocumentIds: [],
      },
    });
  });

  it("exposes search through the Knowhere tool runtime", async () => {
    const result = makeRetrievalResult({
      chunkType: "image",
      source: {
        documentId: "doc_included",
        sourceFileName: "notes.txt",
        sectionPath: "images/diagram.png",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Diagram evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "diagram",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(
      async ({ knowhereTools }: Parameters<GenerateAnswer>[0]) => {
        if (!knowhereTools) throw new Error("Knowhere tools were not provided.");

        const searchResponse = await knowhereTools.search({
          query: "diagram",
          targetContent: "image",
          topK: 2,
        });

        expect(searchResponse.results).toEqual([result]);
        return makeHarnessRunResult("Runtime answer.");
      },
    );
    const sources = [
      makeSource({ id: "source_included", knowhereDocumentId: "doc_included" }),
      makeSource({ id: "source_excluded", knowhereDocumentId: "doc_excluded" }),
    ];

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Show the diagram.",
        namespace: "notebook-workspace",
        sources,
        excludedSourceIds: ["source_excluded"],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(retrieval.query).toHaveBeenCalledWith({
      namespace: "notebook-workspace",
      query: "diagram",
      topK: 2,
      useAgentic: true,
      dataType: 3,
      excludeDocumentIds: ["doc_excluded"],
    });
    expect(answer.answer).toBe("Runtime answer.");
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
      citations: [],
      artifacts: [],
      agentTrace: {
        intentTask: "",
        toolCalls: [],
        referencedDocumentIds: [],
      },
    });
  });

  it("queries at most four namespaces concurrently", async () => {
    const namespaces = [
      "default",
      "notebook-1",
      "notebook-2",
      "notebook-3",
      "notebook-4",
      "notebook-5",
    ];
    const releases: Array<() => void> = [];
    let activeCount = 0;
    let maxActiveCount = 0;
    const retrieval = {
      query: vi.fn(async (params: RetrievalQueryParams) => {
        const namespace = requireRetrievalQueryText(
          params.namespace,
          "namespace",
        );
        const query = requireRetrievalQueryText(params.query, "query");
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise<void>((resolve) => {
          releases.push(() => {
            activeCount -= 1;
            resolve();
          });
        });
        return makeRetrievalQueryResponse(namespace, query);
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "parallel evidence" });
      return makeHarnessRunResult("The answer is grounded.");
    });

    const answerPromise = Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What do the documents say?",
        namespace: "notebook-1",
        namespaces,
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    await vi.waitFor(() => expect(retrieval.query).toHaveBeenCalledTimes(4));
    expect(maxActiveCount).toBe(4);
    releases.splice(0).forEach((release) => release());

    await vi.waitFor(() => expect(retrieval.query).toHaveBeenCalledTimes(6));
    expect(maxActiveCount).toBe(4);
    releases.splice(0).forEach((release) => release());

    await answerPromise;
    expect(maxActiveCount).toBe(4);
  });

  it("retries rate-limited namespace queries sequentially", async () => {
    const namespaces = ["default", "notebook-1", "notebook-2"];
    const attempts = new Map<string, number>();
    const fallbackReleases: Array<() => void> = [];
    let activeFallbackCount = 0;
    let maxActiveFallbackCount = 0;
    const retrieval = {
      query: vi.fn(async (params: RetrievalQueryParams) => {
        const namespace = requireRetrievalQueryText(
          params.namespace,
          "namespace",
        );
        const query = requireRetrievalQueryText(params.query, "query");
        const attempt = (attempts.get(namespace) ?? 0) + 1;
        attempts.set(namespace, attempt);

        if (namespace !== "default" && attempt === 1) {
          throw Object.assign(
            new Error(
              "Too many concurrent requests. Please retry after 30 seconds.",
            ),
            {
              statusCode: 429,
              code: "RESOURCE_EXHAUSTED",
            },
          );
        }

        if (namespace !== "default") {
          activeFallbackCount += 1;
          maxActiveFallbackCount = Math.max(
            maxActiveFallbackCount,
            activeFallbackCount,
          );
          await new Promise<void>((resolve) => {
            fallbackReleases.push(() => {
              activeFallbackCount -= 1;
              resolve();
            });
          });
        }

        return makeRetrievalQueryResponse(namespace, query);
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "rate-limited evidence" });
      return makeHarnessRunResult("The answer is grounded.");
    });

    const answerPromise = Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What do the documents say?",
        namespace: "notebook-1",
        namespaces,
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    await vi.waitFor(() => expect(retrieval.query).toHaveBeenCalledTimes(4));
    expect(maxActiveFallbackCount).toBe(1);
    expect(attempts.get("notebook-2")).toBe(1);
    fallbackReleases.shift()?.();

    await vi.waitFor(() => expect(retrieval.query).toHaveBeenCalledTimes(5));
    expect(maxActiveFallbackCount).toBe(1);
    fallbackReleases.shift()?.();

    await answerPromise;
    expect(attempts).toEqual(
      new Map([
        ["default", 1],
        ["notebook-1", 2],
        ["notebook-2", 2],
      ]),
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "chat-agent: searchSources rate limited; retrying failed namespaces sequentially",
      {
        namespaceCount: 2,
        namespaces: ["notebook-1", "notebook-2"],
      },
    );
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
    const referencedChunksWithProvenance = [
      {
        documentId: "doc_provenance",
        chunkId: "provenance-only-id",
        pageNums: [],
      } as unknown as (typeof referencedChunks)[number],
      ...referencedChunks,
    ];
    const retrieval = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          results: defaultResults,
          evidenceText: "Default evidence",
          referencedChunks: referencedChunksWithProvenance,
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
          referencedChunks: referencedChunksWithProvenance,
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
        expect(response.referencedChunks[0]?.chunkId).toBe("chunk_1");
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
      return makeHarnessRunResultWithLedger(
        "Revenue improved [Source 1: revenue growth]. Margins expanded [Source 2: margin expansion].",
        {
          citations: [
            makeOutputCitation("r1:result:1", firstResult),
            makeOutputCitation("r1:result:2", secondResult),
          ],
          chunks: [
            makeEvidenceChunkFromRetrievalResult("r1:result:1", firstResult),
            makeEvidenceChunkFromRetrievalResult("r1:result:2", secondResult),
          ],
        },
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

  it("keeps two manifest citations to the same evidence chunk as two answer citations", async () => {
    const result = makeRetrievalResult({
      content: "Revenue grew on the same page twice.",
      chunkType: "page",
      source: {
        documentId: "doc_included",
        sourceFileName: "spacex-s1.pdf",
        sectionPath: "Page 26",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Revenue page evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "What grew?",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
    const generateAnswer = vi.fn(async ({ searchSources }) => {
      await searchSources({ query: "What grew?" });
      return makeHarnessRunResultWithLedger(
        "Revenue grew [[cite:1]] and later expanded [[cite:2]].",
        {
          citations: [
            makeOutputCitation("r1:result:1", result),
            makeOutputCitation("r1:result:1", result),
          ],
          chunks: [makeEvidenceChunkFromRetrievalResult("r1:result:1", result)],
        },
      );
    });

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What grew?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.answer).toBe(
      "Revenue grew [[cite:1]] and later expanded [[cite:2]].",
    );
    expect(answer.citations).toHaveLength(2);
    expect(answer.citations[0]?.source.sectionPath).toBe("Page 26");
    expect(answer.citations[1]?.source.sectionPath).toBe("Page 26");
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
      return makeCitedHarnessRunResult(
        "Tesla invested in xAI [Source 1: xAI investment].",
        result,
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
      knowhereTools: expect.any(Object),
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
      return makeCitedHarnessRunResult(
        `Use this launch photo. ${upstreamAssetUrl}`,
        result,
      );
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
          memoryCitations: [],
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
            retainedPicks: [],
            pendingRetention: null,
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.9,
                assetUrl: rawAssetUrl,
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
      return makeCitedHarnessRunResult(
        `This page has the answer. ${storedPageAssetUrl}`,
        result,
      );
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
    const pageMetadata = {
      pageNums: [6],
      pageAssets: [
        {
          pageNum: 6,
          artifactRef: "page_citation_assets/page-6.png",
          assetUrl: rawPageAssetUrl,
          contentType: "image/png",
        },
      ],
    };
    const referencedPageChunk: HarnessRunResult["trace"]["ledger"]["chunks"][number] = {
      ref: "r1:referenced:1",
      kind: "referenced_chunk",
      chunkId: "chunk_page_6",
      content: "",
      contentPreview: "",
      chunkType: "page",
      score: null,
      filePath: null,
      metadata: pageMetadata,
      source: {
        documentId: "doc_pages",
        sourceFileName: null,
        sectionPath: "Page 6",
      },
      revisionKey: "job_1",
      assetUrl: rawPageAssetUrl,
    };
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
            metadata: pageMetadata,
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
      return makeHarnessRunResultWithLedger("This page has referenced evidence.", {
        citations: [
          {
            ref: "r1:referenced:1",
            label: "Page 6",
            source: referencedPageChunk.source,
          },
        ],
        chunks: [referencedPageChunk],
      });
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

  it("hydrates page numbers for citations missing page metadata from the matching parsed chunk", async () => {
    const grepChunk = {
      ref: "r1:result:1",
      kind: "result" as const,
      chunkId: "chunk_financial_summary",
      content: "ept percentages and per share data)\nTotal automotive revenues\n17,693",
      contentPreview: "ept percentages and per share data)",
      chunkType: "page",
      score: null,
      metadata: {
        position: 1,
        startOffset: 12,
        endOffset: 80,
      },
      source: {
        documentId: "doc_tsla",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "FINANCIAL SUMMARY",
      },
    };
    const retrieval = {
      query: vi.fn(),
    };
    const readChunks = vi.fn().mockResolvedValue({
      document: {
        documentId: "doc_tsla",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
      },
      chunks: [
        {
          position: 1,
          chunkId: "chunk_financial_summary",
          chunkType: "page",
          content: "Full financial summary page.",
          readableContent: "Full financial summary page.",
          sectionPath: "FINANCIAL SUMMARY",
          sourceChunkPath: "pages/page-4.md",
          pageNumbers: [4, 5],
          metadata: {
            pageNums: [4, 5],
          },
        },
      ],
    });
    const generateAnswer = vi.fn(async () =>
      makeHarnessRunResultWithLedger(
        "Automotive revenue was $17,693 million [[cite:1]].",
        {
          citations: [{ ref: "r1:result:1" }],
          chunks: [grepChunk],
        },
      ),
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Tesla automotive revenue",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_tsla",
            title: "TSLA-Q4-2025-Update.pdf",
            knowhereDocumentId: "doc_tsla",
          }),
        ],
        excludedSourceIds: [],
        retrieval,
        knowledge: { readChunks } as unknown as Knowledge,
        generateAnswer,
        messages: [],
      }),
    );

    expect(readChunks).toHaveBeenCalledWith({
      documentId: "doc_tsla",
      chunkId: "chunk_financial_summary",
    });
    expect(answer.citations[0]?.pageCitationPageNumber).toBe(4);
    expect(answer.citations[0]?.source.sectionPath).toBe("FINANCIAL SUMMARY");
  });

  it("copies inspect-image provenance boxes onto cited page results", async () => {
    const pageResult = makeRetrievalResult({
      chunkType: "page",
      metadata: { page_nums: [4] },
      source: {
        documentId: "doc_tsla",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Page 4",
      },
    });
    const generateAnswer = vi.fn(async () =>
      makeHarnessRunResultWithLedger("Automotive revenue was $17.7B [[cite:1]].", {
        citations: [makeOutputCitation("r1:result:1", pageResult)],
        chunks: [
          {
            ...makeEvidenceChunkFromRetrievalResult("r1:result:1", pageResult),
          },
        ],
        assets: [
          {
            ref: "asset:r1:result:1",
            chunkRef: "r1:result:1",
            type: "image",
            source: pageResult.source,
            label: "TSLA-Q4-2025-Update.pdf / Page 4",
          },
        ],
        imageHighlights: [
          {
            ref: "asset:r1:result:1",
            regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }],
          },
        ],
      }),
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "Tesla automotive revenue",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_tsla",
            title: "TSLA-Q4-2025-Update.pdf",
            knowhereDocumentId: "doc_tsla",
          }),
        ],
        excludedSourceIds: [],
        retrieval: { query: vi.fn() },
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.citations[0]?.highlightRegions).toEqual([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.15 },
    ]);
  });

  it("copies boxes from a referenced page asset onto its cited result chunk", async () => {
    const pageResult = makeRetrievalResult({
      chunkId: "chunk_page_4",
      chunkType: "page",
      metadata: { page_nums: [4] },
      source: {
        documentId: "doc_tsla",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "FINANCIAL SUMMARY",
      },
    });
    const resultChunk = makeEvidenceChunkFromRetrievalResult(
      "r1:result:1",
      pageResult,
    );
    const referencedChunk = {
      ...resultChunk,
      ref: "r1:referenced:1",
      kind: "referenced_chunk" as const,
    };
    const generateAnswer = vi.fn(async () =>
      makeHarnessRunResultWithLedger("Revenue was $24.9B [[cite:1]].", {
        citations: [makeOutputCitation("r1:result:1", pageResult)],
        chunks: [resultChunk, referencedChunk],
        assets: [
          {
            ref: "asset:r1:referenced:1",
            chunkRef: "r1:referenced:1",
            type: "image",
            source: pageResult.source,
            label: "TSLA-Q4-2025-Update.pdf / Page 4",
          },
        ],
        imageHighlights: [
          {
            ref: "asset:r1:referenced:1",
            regions: [{ x: 0.08, y: 0.42, w: 0.84, h: 0.12 }],
          },
        ],
      }),
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What was Tesla's Q4 revenue?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_tsla",
            title: "TSLA-Q4-2025-Update.pdf",
            knowhereDocumentId: "doc_tsla",
          }),
        ],
        excludedSourceIds: [],
        retrieval: { query: vi.fn() },
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.citations[0]?.highlightRegions).toEqual([
      { x: 0.08, y: 0.42, w: 0.84, h: 0.12 },
    ]);
  });

  it("reuses boxes from a deduplicated page alias across namespaces", async () => {
    const catalogResult = makeRetrievalResult({
      chunkId: "chunk_page_4",
      chunkType: "page",
      metadata: { page_nums: [4] },
      source: {
        documentId: "doc_catalog",
        sourceFileName: "original.pdf",
        sectionPath: "FINANCIAL SUMMARY",
      },
    });
    const workspaceResult = makeRetrievalResult({
      ...catalogResult,
      source: {
        documentId: "doc_workspace",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "FINANCIAL SUMMARY",
      },
    });
    const catalogChunk = {
      ...makeEvidenceChunkFromRetrievalResult("r1:result:1", catalogResult),
    };
    const workspaceChunk = {
      ...makeEvidenceChunkFromRetrievalResult("r1:result:2", workspaceResult),
    };
    const assets = [
      {
        ref: "asset:r1:result:1",
        chunkRef: "r1:result:1",
        type: "image" as const,
        assetUrl: "https://assets.example/tsla/page-4.png",
        sourcePath: "page_citation_assets/page-4.png",
        source: catalogResult.source,
        label: "original.pdf / Page 4",
      },
      {
        ref: "asset:r1:result:2",
        chunkRef: "r1:result:2",
        type: "image" as const,
        assetUrl: "https://assets.example/tsla/page-4.png",
        sourcePath: "page_citation_assets/page-4.png",
        source: workspaceResult.source,
        label: "TSLA-Q4-2025-Update.pdf / Page 4",
      },
    ];
    const generateAnswer = vi.fn(async () =>
      makeHarnessRunResultWithLedger("Revenue was $24.9B [[cite:1]].", {
        citations: [makeOutputCitation("r1:result:2", workspaceResult)],
        chunks: [catalogChunk, workspaceChunk],
        assets,
        imageHighlights: [
          {
            ref: "asset:r1:result:1",
            regions: [{ x: 0.2, y: 0.3, w: 0.5, h: 0.08 }],
          },
        ],
      }),
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What was Tesla's Q4 revenue?",
        namespace: "notebook-workspace",
        sources: [
          makeSource({
            id: "source_tsla",
            title: "TSLA-Q4-2025-Update.pdf",
            knowhereDocumentId: "doc_workspace",
          }),
        ],
        excludedSourceIds: [],
        retrieval: { query: vi.fn() },
        generateAnswer,
        messages: [],
      }),
    );

    expect(answer.citations[0]?.highlightRegions).toEqual([
      { x: 0.2, y: 0.3, w: 0.5, h: 0.08 },
    ]);
  });

  it("returns the exact displayed artifact set from the harness manifest", async () => {
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
          memoryCitations: [],
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
            retainedPicks: [],
            pendingRetention: null,
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.9,
                assetUrl: frontAssetUrl,
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
          imageHighlights: [],
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
      extraAssetUrl,
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
        {
          documentId: "doc_identity",
          sourceFileName: "商务标文件.pdf",
          sectionPath: "营业执照",
        },
      ],
    );
    expect(answer.citations.map((citation) => citation.assetUrl)).toEqual([
      frontAssetUrl,
      backAssetUrl,
      extraAssetUrl,
    ]);
  });

  it("returns agent output when a legacy harness trace has validation errors", async () => {
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
      answer: "This invalid answer should not ship.",
      citations: [],
      artifacts: [],
      agentTrace: {
        intentTask: "",
        toolCalls: [],
        referencedDocumentIds: [],
      },
    });
  });

  it("renders answer and resolves citations when manifest source metadata is wrong", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    const result = makeRetrievalResult({
      content: "Information hiding is a module design principle.",
      source: {
        documentId: "doc_information_hiding",
        sourceFileName: "information_hiding.pdf",
        sectionPath: "Root / Module Design",
      },
    });
    const retrieval = {
      query: vi.fn().mockResolvedValue({
        results: [result],
        evidenceText: "Information hiding evidence.",
        referencedChunks: [],
        namespace: "notebook-workspace",
        query: "information hiding",
        routerUsed: "workflow_single_step",
        answerText: null,
      }),
    };
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
            task: "answer",
            dependsOnPreviousTurn: false,
            retrievalNeeded: "yes",
            targetModalities: ["text"],
            constraints: { citationRequired: true },
            groundingPolicy: "must_use_sources",
          });
          await tools.setContextPolicy?.execute({
            carryHistory: "none",
            reason: "Self-contained request.",
            activePriorTurnIds: [],
          });
          await tools.knowhere_search?.execute({
            query: "information hiding",
            targetContent: "text",
          });
          await tools.retainEvidence?.execute({ picks: [1] });
        }

        await tools.finalize?.execute({
          text: "Information hiding is a module design principle.",
          citations: [{ pick: 1 }],
          memoryCitations: [],
          artifacts: [],
          unresolved: [],
        });

        return {
          text: "ignored",
          response: { messages: [] },
        } as unknown as Awaited<ReturnType<ToolLoopAgent["generate"]>>;
      },
    );

    const answer = await Effect.runPromise(
      answerQuestionWithRetrieval({
        question: "What is information hiding?",
        namespace: "notebook-workspace",
        sources: [makeSource()],
        excludedSourceIds: [],
        retrieval,
        generateAnswer: (input) =>
          generateAgenticOutputManifest({
            ...input,
            workspaceId: "workspace_1",
          }),
        messages: [],
      }),
    );

    expect(generateCallCount).toBe(1);
    expect(answer.answer).toBe("Information hiding is a module design principle.");
    expect(answer.artifacts).toEqual([]);
    expect(answer.citations.map((citation) => citation.source)).toEqual([
      {
        documentId: "doc_information_hiding",
        sourceFileName: "information_hiding.pdf",
        sectionPath: "Root / Module Design",
      },
    ]);
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
          memoryCitations: [],
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
            retainedPicks: [],
            pendingRetention: null,
            chunks: [
              {
                ref: "r1:result:1",
                kind: "result",
                content: "",
                contentPreview: "",
                chunkType: "image",
                score: 0.9,
                assetUrl,
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
          memoryCitations: [],
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
            retainedPicks: [],
            pendingRetention: null,
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
      knowhereTools: expect.any(Object),
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

  it("throws when the harness finalizes with empty answer text", async () => {
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
      const run = makeHarnessRunResult("");
      return {
        ...run,
        manifest: {
          ...run.manifest,
          unresolved: ["The requested fact is not present in the sources."],
        },
      };
    });

    await expect(
      Effect.runPromise(
        answerQuestionWithRetrieval({
          question: "Missing fact?",
          namespace: "notebook-workspace",
          sources: [makeSource()],
          excludedSourceIds: [],
          retrieval,
          generateAnswer,
          messages: [],
        }),
      ),
    ).rejects.toThrow();
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
      knowhereTools: expect.any(Object),
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
        useAgentic: false,
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
      useAgentic: false,
      dataType: 1,
    });
    expect(JSON.stringify(queryInput)).not.toContain(
      "do-not-append-this-history-to-query",
    );
  });

  it("uses structured referenced chunks from RetrievalQueryResponse as citations", async () => {
    const referencedImageChunk: HarnessRunResult["trace"]["ledger"]["chunks"][number] = {
      ref: "r1:referenced:1",
      kind: "referenced_chunk",
      chunkId: "chunk_1",
      content: "",
      contentPreview: "",
      chunkType: "image",
      score: null,
      filePath: "images/launch.jpg",
      source: {
        documentId: "doc_spacex",
        sourceFileName: null,
        sectionPath: "Assets / images / launch.jpg",
      },
      revisionKey: "job_1",
      assetUrl: "https://blob.example/images/launch.jpg",
    };
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
      return makeHarnessRunResultWithLedger("Here is the launch image.", {
        citations: [
          {
            ref: "r1:referenced:1",
            label: "launch image",
            source: referencedImageChunk.source,
          },
        ],
        chunks: [referencedImageChunk],
      });
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
        chunkId: "chunk_1",
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
        await tools.knowhere_search?.execute({
          query: "冯荣洲 身份证 图片",
          targetContent: "text_image",
          topK: 2,
          purpose: "Find exactly the requested identity-card images.",
        });
        await tools.retainEvidence?.execute({ picks: [1] });
        await tools.finalize?.execute({
          text: "已找到相关身份证图片，见下方图片。",
          citations: [{ pick: 1 }],
          memoryCitations: [],
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
      workspaceId: "workspace_1",
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

  it("keeps an over-budget manifest after the first generation", async () => {
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
          await tools.knowhere_search?.execute({
            query: "身份证 图片",
            targetContent: "image",
            topK: 3,
            purpose: "Find requested identity images.",
          });
          await tools.retainEvidence?.execute({ picks: [1, 2, 3] });
          await tools.finalize?.execute({
            text: "见下方图片。",
            citations: [{ pick: 1 }],
            memoryCitations: [],
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
            citations: [{ pick: 1 }],
            memoryCitations: [],
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
      workspaceId: "workspace_1",
      question: "只要 2 张身份证图片",
      messages: [],
      sources: [
        makeSource({ title: "ids.pdf", knowhereDocumentId: "doc_identity" }),
      ],
      excludedSourceIds: [],
      searchSources,
    });

    expect(generateCallCount).toBe(1);
    expect(result.trace.revisionsUsed).toBe(0);
    expect(result.trace.validationErrors).toEqual([]);
    expect(
      result.manifest.artifacts.filter((artifact) => artifact.display).length,
    ).toBe(3);
  });
});

describe("parseChatRequestBody", () => {
  it("accepts a trimmed message, optional thread id, and string source exclusions", () => {
    expect(
      parseChatRequestBody({
        message: "  What changed?  ",
        threadId: "thread_1",
        excludedSourceIds: ["source_1", 7, "source_2"],
        folderId: " folder_1 ",
      }),
    ).toEqual({
      ok: true,
      value: {
        question: "What changed?",
        threadId: "thread_1",
        useAgentic: true,
        excludedSourceIds: ["source_1", "source_2"],
        folderId: "folder_1",
      },
    });
  });

  it("keeps an explicit useAgentic choice from the request body", () => {
    expect(
      parseChatRequestBody({
        message: "Quick summary",
        useAgentic: false,
      }),
    ).toEqual({
      ok: true,
      value: {
        question: "Quick summary",
        useAgentic: false,
        excludedSourceIds: [],
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

function makeRetrievalQueryResponse(
  namespace: string,
  query: string,
): RetrievalQueryResponse {
  return {
    results: [makeRetrievalResult()],
    evidenceText: `Evidence from ${namespace}`,
    referencedChunks: [],
    namespace,
    query,
    routerUsed: "workflow_single_step",
    answerText: null,
    stopReason: "answer_done",
    failureReason: null,
  };
}

function requireRetrievalQueryText(
  value: string | undefined,
  name: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected retrieval ${name}.`);
  }
  return value;
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
    chunkCount: null,
    folderId: null,
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
      memoryCitations: [],
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
        retainedPicks: [],
        pendingRetention: null,
      },
      finalized: true,
      priorTurnReads: [],
      toolCalls: [],
      imageHighlights: [],
      validationErrors: [],
      revisionsUsed: 0,
    },
  };
}

function makeCitedHarnessRunResult(
  text: string,
  result: RetrievalResult,
  ref = "r1:result:1",
): HarnessRunResult {
  return makeHarnessRunResultWithLedger(text, {
    citations: [makeOutputCitation(ref, result)],
    chunks: [makeEvidenceChunkFromRetrievalResult(ref, result)],
  });
}

function makeHarnessRunResultWithLedger(
  text: string,
  input: {
    readonly citations?: HarnessRunResult["manifest"]["citations"]
    readonly chunks?: HarnessRunResult["trace"]["ledger"]["chunks"]
    readonly assets?: HarnessRunResult["trace"]["ledger"]["assets"]
    readonly artifacts?: HarnessRunResult["manifest"]["artifacts"]
    readonly imageHighlights?: HarnessRunResult["trace"]["imageHighlights"]
  },
): HarnessRunResult {
  const chunks = input.chunks ?? [];
  return {
    manifest: {
      text,
      citations: input.citations ?? [],
      memoryCitations: [],
      artifacts: input.artifacts ?? [],
      unresolved: [],
    },
    trace: {
      ...makeHarnessRunResult("").trace,
      imageHighlights: input.imageHighlights ?? [],
      ledger: {
        retrievalCount: chunks.length > 0 ? 1 : 0,
        chunks,
        assets: input.assets ?? [],
        evidenceText: [],
        stopReasons: [],
        failureReasons: [],
        decisionTraces: [],
        retainedPicks: [],
        pendingRetention: null,
      },
    },
  };
}

function makeOutputCitation(
  ref: string,
  result: RetrievalResult,
): HarnessRunResult["manifest"]["citations"][number] {
  return {
    ref,
    label: [result.source.sourceFileName, result.source.sectionPath]
      .filter(Boolean)
      .join(" / "),
    source: {
      documentId: result.source.documentId,
      sourceFileName: result.source.sourceFileName,
      sectionPath: result.source.sectionPath,
    },
  };
}

function makeEvidenceChunkFromRetrievalResult(
  ref: string,
  result: RetrievalResult,
): HarnessRunResult["trace"]["ledger"]["chunks"][number] {
  return {
    ref,
    kind: "result",
    ...(result.chunkId ? { chunkId: result.chunkId } : {}),
    content: result.content,
    contentPreview: result.content,
    chunkType: result.chunkType,
    score: result.score,
    ...(result.sourceChunkPath ? { sourceChunkPath: result.sourceChunkPath } : {}),
    ...(result.filePath ? { filePath: result.filePath } : {}),
    ...(result.metadata ? { metadata: result.metadata } : {}),
    source: {
      documentId: result.source.documentId,
      sourceFileName: result.source.sourceFileName,
      sectionPath: result.source.sectionPath,
    },
    ...(result.assetUrl ? { assetUrl: result.assetUrl } : {}),
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
