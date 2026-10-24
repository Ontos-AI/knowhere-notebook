import { describe, expect, it } from "vitest"
import { toChatCitationViews } from "./citations"
import { chatCitationPersistence } from "./chat-citation-persistence"
import { toChatMessageView } from "./view"
import { resolveCitationChunk } from "@/domains/chunks"
import { workspaceClientCache } from "@/domains/workspace/client-cache"
import type { ChatCitationView } from "./types"
import type { ChatMessage } from "@/infrastructure/db/schema"

const citation: ChatCitationView = {
  chunkId: "parser_1",
  chunkRowId: "row_1",
  chunkType: "text",
  score: 0.9,
  source: { documentId: "doc_1", namespace: "__knowhere_demo__", jobResultId: "revision_old", sectionPath: "Summary" },
}

describe("revision-safe citations", () => {
  it("keeps the actual retrieval revision and separate parser and row identifiers", () => {
    const result = toChatCitationViews([{ ...citation, content: "Body" }], "Answer")
    expect(result[0]).toMatchObject(citation)
  })

  it("round trips citation provenance without storing retrieved content", () => {
    const persisted = chatCitationPersistence.normalizeCitations([{ ...citation, content: "Do not persist" }])
    expect(persisted?.[0]).toMatchObject(citation)
    expect(persisted?.[0]).not.toHaveProperty("content")
    const message: ChatMessage = { id: "m1", threadId: "t1", role: "assistant", content: "Answer", citations: persisted, artifacts: null, agentTrace: null, createdAt: new Date() }
    expect(toChatMessageView(message).citations?.[0]).toMatchObject(citation)
  })

  it("exposes saved partial retrieval warnings from the validated trace", () => {
    const warning = { scope: "demo", code: "demo_unavailable", message: "Shared documents were unavailable." } as const
    const message: ChatMessage = { id: "m1", threadId: "t1", role: "assistant", content: "Answer", citations: null, artifacts: null, agentTrace: { intentTask: "answer", toolCalls: [], referencedDocumentIds: [], retrievalWarnings: [warning] }, createdAt: new Date() }
    expect(toChatMessageView(message).retrievalWarnings).toEqual([warning])
  })

  it("focuses an exact parser identifier only within the cited revision", () => {
    const makeChunk = (jobResultId: string, chunkId: string) => ({ chunkId, parserChunkId: "parser_1", documentId: "doc_1", namespace: "__knowhere_demo__", jobResultId, type: "text" as const, content: "Body", sectionPath: "Summary", sourceTitle: "Report" })
    expect(resolveCitationChunk(citation, [makeChunk("revision_new", "row_new")])).toBeNull()
    expect(resolveCitationChunk(citation, [makeChunk("revision_new", "row_new"), makeChunk("revision_old", "row_1")])?.chunkId).toBe("row_1")
  })

  it("isolates chunk cache entries by revision, namespace and chunk type", () => {
    const current = workspaceClientCache.getSourceChunksKey("demo_1", 0, null, { jobResultId: "new", namespace: "__knowhere_demo__", chunkType: "page" })
    const saved = workspaceClientCache.getSourceChunksKey("demo_1", 0, null, { jobResultId: "old", namespace: "__knowhere_demo__", chunkType: "page" })
    const text = workspaceClientCache.getSourceChunksKey("demo_1", 0, null, { jobResultId: "old", namespace: "__knowhere_demo__", chunkType: "text" })
    expect(current).not.toEqual(saved)
    expect(saved).not.toEqual(text)
  })
})
