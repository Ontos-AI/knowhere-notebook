import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import type { RetrievalQueryParams, RetrievalQueryResponse } from "@ontos-ai/knowhere-sdk"
import type { HarnessRunResult } from "@/agent-harness"
import type { Source } from "@/infrastructure/db/schema"
import { answerQuestionWithRetrieval } from "./index"
import type { AnswerQuestionInput, GenerateAnswer } from "./contracts"

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/integrations/memento/client", () => ({ listActivations: vi.fn().mockResolvedValue([]) }))

const DEMO_NAMESPACE = "__knowhere_demo__"
const privateSource: Source = {
  id: "private", workspaceId: "workspace", title: "Private", mimeType: "text/plain", sizeBytes: 1,
  status: "ready", knowhereDocumentId: "private-doc", knowhereJobId: "private-job", demoKey: null,
  failureReason: null, failureStage: null, stagedBlobPathname: null, stagedBlobUrl: null,
  originalBlobPathname: null, originalBlobUrl: null, chunkCount: 1, folderId: null,
  createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null,
}
const sharedSource = { ...privateSource, id: "demo:visible", title: "Shared", demoKey: "visible",
  knowhereDocumentId: "shared-doc", knowhereJobId: null, namespace: DEMO_NAMESPACE, jobResultId: "catalog-revision" }
const legacySource = { ...privateSource, id: "legacy", demoKey: "visible", knowhereDocumentId: "old-private-demo" }

function makeResponse(namespace: string, results: RetrievalQueryResponse["results"] = []): RetrievalQueryResponse {
  return { namespace, query: "question", routerUsed: "test", answerText: null, results, referencedChunks: [] }
}
function makeHarnessResult(): HarnessRunResult {
  return { manifest: { text: "Available evidence", citations: [], artifacts: [], unresolved: [], memoryCitations: [] },
    memoryItems: [], trace: { ledger: { retrievalCount: 0, chunks: [], assets: [], evidence: [], stopReasons: [], failureReasons: [], decisionTraces: [] },
      finalized: true, priorTurnReads: [], toolCalls: [], imageHighlights: [], validationErrors: [], revisionsUsed: 0 } }
}
function makeInput(overrides: Partial<AnswerQuestionInput> = {}): AnswerQuestionInput {
  return { question: "question", namespace: "default", sources: [privateSource, sharedSource, legacySource],
    excludedSourceIds: [], messages: [], retrieval: { query: vi.fn(async (params: RetrievalQueryParams) => makeResponse(params.namespace ?? "default")) },
    generateAnswer: async ({ searchSources }) => { await searchSources({ query: "question" }); return makeHarnessResult() }, ...overrides }
}

describe("shared demo retrieval", () => {
  it("queries demo-only sources with an explicit include scope and no private namespace", async () => {
    const input = makeInput({ sources: [sharedSource] })
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ namespace: DEMO_NAMESPACE, includeDocumentIds: ["shared-doc"] }))
  })

  it("separates mixed scopes and always excludes historical private demos", async () => {
    const input = makeInput()
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).toHaveBeenCalledTimes(2)
    expect(input.retrieval.query).toHaveBeenCalledWith(expect.objectContaining({ namespace: "default", excludeDocumentIds: ["old-private-demo"] }))
    expect(input.retrieval.query).toHaveBeenCalledWith(expect.objectContaining({ namespace: DEMO_NAMESPACE, includeDocumentIds: ["shared-doc"] }))
  })

  it("skips the shared query when all visible demos are deselected", async () => {
    const input = makeInput({ sources: [sharedSource], excludedSourceIds: [sharedSource.id] })
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).not.toHaveBeenCalled()
  })

  it("keeps a private folder separate from shared demos and intersects agent includes", async () => {
    const input = makeInput({ folderScopeSourceIds: [privateSource.id, legacySource.id],
      generateAnswer: async ({ searchSources }) => { await searchSources({ query: "question", includeDocumentIds: ["shared-doc", "old-private-demo"] }); return makeHarnessResult() } })
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).not.toHaveBeenCalled()
  })

  it("intersects agent demo includes with the selected visible demos", async () => {
    const input = makeInput({ sources: [sharedSource], generateAnswer: async ({ searchSources }) => {
      await searchSources({ query: "question", includeDocumentIds: ["hidden-demo", "shared-doc"] }); return makeHarnessResult()
    } })
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ namespace: DEMO_NAMESPACE, includeDocumentIds: ["shared-doc"] }))
  })

  it("returns and persists a warning when private retrieval fails but demo evidence is available", async () => {
    const input = makeInput({ retrieval: { query: vi.fn(async (params: RetrievalQueryParams) => {
      if (params.namespace === "default") throw new Error("private unavailable")
      return makeResponse(DEMO_NAMESPACE, [{ content: "Evidence", chunkType: "text", score: 1, source: { documentId: "shared-doc" } }])
    }) } })
    const answer = await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(answer).toMatchObject({ retrievalWarnings: [{ scope: "workspace", code: "retrieval_failed" }],
      agentTrace: { retrievalWarnings: [{ scope: "workspace", code: "retrieval_failed" }] } })
  })

  it("fails when a retrieval failure has no successful evidence even if the agent catches it", async () => {
    const generateAnswer: GenerateAnswer = async ({ searchSources }) => {
      try { await searchSources({ query: "question" }) } catch { /* Harness can catch tool errors. */ }
      return makeHarnessResult()
    }
    const input = makeInput({ generateAnswer, retrieval: { query: vi.fn(async (params: RetrievalQueryParams) => {
      if (params.namespace === "default") throw new Error("private unavailable")
      return makeResponse(DEMO_NAMESPACE)
    }) } })
    await expect(Effect.runPromise(answerQuestionWithRetrieval(input))).rejects.toThrow("private unavailable")
  })
  it("does not treat an answer without evidence as recovery from a failed scope", async () => {
    const input = makeInput({ retrieval: { query: vi.fn(async (params: RetrievalQueryParams) => {
      if (params.namespace === "default") throw new Error("workspace unavailable")
      return { ...makeResponse(DEMO_NAMESPACE), answerText: "I could not find evidence." }
    }) } })
    await expect(Effect.runPromise(answerQuestionWithRetrieval(input))).rejects.toThrow()
  })

  it("warns about a failed demo scope while preserving private evidence and filters", async () => {
    const input = makeInput({ retrieval: { query: vi.fn(async (params: RetrievalQueryParams) => {
      if (params.namespace === DEMO_NAMESPACE) throw new Error("demo unavailable")
      return makeResponse("default", [{ content: "Evidence", chunkType: "text", score: 1, source: { documentId: "private-doc" } }])
    }) }, generateAnswer: async ({ searchSources }) => {
      await searchSources({ query: "question", signalPaths: ["table"], filterMode: "keep", threshold: 0.25, targetContent: "table" })
      return makeHarnessResult()
    } })
    const answer = await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(answer).toMatchObject({ retrievalWarnings: [{ scope: "demo", code: "retrieval_failed" }] })
    expect(input.retrieval.query).toHaveBeenCalledWith(expect.objectContaining({ namespace: DEMO_NAMESPACE,
      includeDocumentIds: ["shared-doc"], signalPaths: ["table"], filterMode: "keep", threshold: 0.25, dataType: 4 }))
  })

  it("keeps shared document IDs out of a private agent include scope", async () => {
    const input = makeInput({ generateAnswer: async ({ searchSources }) => {
      await searchSources({ query: "question", includeDocumentIds: ["shared-doc", "private-doc", "old-private-demo"] })
      return makeHarnessResult()
    } })
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).toHaveBeenCalledWith(expect.objectContaining({ namespace: "default", includeDocumentIds: ["private-doc"] }))
  })

  it("keeps a catalog preparation failure visible when private retrieval supplies evidence", async () => {
    const warning = { scope: "demo" as const, code: "demo_catalog_unavailable", message: "Demo catalog is unavailable." }
    const input = makeInput({ sources: [privateSource], retrievalPreparationFailures: [{ warning, cause: new Error("catalog unavailable") }],
      retrieval: { query: vi.fn(async () => makeResponse("default", [{ content: "Evidence", chunkType: "text", score: 1, source: { documentId: "private-doc" } }])) } })
    const answer = await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(answer).toMatchObject({ retrievalWarnings: [warning], agentTrace: { retrievalWarnings: [warning] } })
  })

  it("does not borrow page metadata from a different document revision", async () => {
    const chunk = { ref: "actual", kind: "result" as const, chunkId: "stable-parser-id", content: "Evidence", contentPreview: "Evidence",
      chunkType: "text", score: 1, source: { documentId: "shared-doc", namespace: DEMO_NAMESPACE, jobResultId: "actual-retrieval-revision" } }
    const donor = { ...chunk, ref: "different-revision", source: { ...chunk.source, jobResultId: "newer-catalog-revision" }, metadata: { pageNums: [99] } }
    const generated = makeHarnessResult()
    const input = makeInput({ sources: [sharedSource], generateAnswer: async () => ({ ...generated,
      manifest: { ...generated.manifest, citations: [{ ref: "actual" }] },
      trace: { ...generated.trace, ledger: { ...generated.trace.ledger, chunks: [chunk, donor] } } }) })
    const answer = await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(answer.citations[0]?.source).toMatchObject({ namespace: DEMO_NAMESPACE, jobResultId: "actual-retrieval-revision" })
    expect(answer.citations[0]?.pageCitationPageNumber).toBeUndefined()
  })

  it.each(["image", "table"] as const)("retains actual provenance for a displayed shared %s artifact", async (type) => {
    const generated = makeHarnessResult()
    const reference = { documentId: "shared-doc", namespace: DEMO_NAMESPACE, jobResultId: "actual-artifact-revision" }
    const input = makeInput({ sources: [sharedSource], generateAnswer: async () => ({ ...generated,
      manifest: { ...generated.manifest, artifacts: [{ type, ref: "asset", display: true, reason: "Requested source artifact" }] },
      trace: { ...generated.trace, ledger: { ...generated.trace.ledger,
        assets: [{ ref: "asset", chunkRef: "chunk", type, label: "Shared artifact", source: reference, revisionKey: "actual-artifact-revision", assetUrl: "https://example.com/asset" }] } } }) })
    const answer = await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(answer.artifacts?.[0]?.citation?.source).toMatchObject(reference)
  })

  it("skips the private namespace when all private rows are deselected and a demo remains selected", async () => {
    const input = makeInput({ excludedSourceIds: [privateSource.id] })
    await Effect.runPromise(answerQuestionWithRetrieval(input))
    expect(input.retrieval.query).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ namespace: DEMO_NAMESPACE, includeDocumentIds: ["shared-doc"] }))
  })

})
