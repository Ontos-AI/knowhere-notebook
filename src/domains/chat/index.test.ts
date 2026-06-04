import { afterEach, describe, expect, it, vi } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"
import { Effect } from "effect"
import { generateText } from "ai"

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

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));

afterEach(() => {
  vi.mocked(generateText).mockReset();
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
    });
    expect(answer).toEqual({
      answer: "The answer is grounded.",
      citations: [result],
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
      await searchSources({ query: "SpaceX rocket photos", dataType: 3 });
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
    });
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
  });
});

describe("generateAgenticGroundedAnswer", () => {
  it("builds a Vercel AI SDK tool loop around Knowhere retrieval", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key";
    vi.mocked(generateText).mockResolvedValue({
      text: "Here are the requested identity images.",
    } as Awaited<ReturnType<typeof generateText>>);
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
    });

    expect(answer).toBe("Here are the requested identity images.");
    const generateTextInput = vi.mocked(generateText).mock.calls[0]?.[0] as unknown as {
      readonly system: string
      readonly messages: readonly { readonly role: string; readonly content: string }[]
      readonly tools: {
        readonly searchSources: {
          readonly execute: (input: {
            readonly query: string
            readonly dataType?: number
          }) => Promise<unknown>
        }
      }
      readonly prepareStep: (input: { readonly stepNumber: number }) => unknown
    }
    expect(generateTextInput.system).toContain("RetrievalQueryResponse")
    expect(generateTextInput.system).toContain("dataType=3")
    expect(generateTextInput.messages.at(-1)).toEqual({
      role: "user",
      content: "请发送几张关于公民身份的图片给我",
    })
    expect(generateTextInput.prepareStep({ stepNumber: 0 })).toMatchObject({
      toolChoice: { type: "tool", toolName: "searchSources" },
      activeTools: ["searchSources"],
    })

    const toolOutput = await generateTextInput.tools.searchSources.execute({
      query: "公民身份证 图片",
      dataType: 3,
    });

    expect(searchSources).toHaveBeenCalledWith({
      query: "公民身份证 图片",
      dataType: 3,
    });
    expect(toolOutput).toMatchObject({
      query: "公民身份证 图片",
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
    expect(prompt).toContain("evidenceText")
    expect(prompt).toContain("failureReason")
    expect(prompt).toContain("decisionTrace")
    expect(prompt).toContain("remote source index")
    expect(prompt).toContain("person or section but not an image asset")
    expect(prompt).toContain("身份证")
    expect(prompt).toContain("For image requests use dataType=3")
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
