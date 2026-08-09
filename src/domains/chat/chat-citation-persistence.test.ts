import { describe, expect, it } from "vitest"

import { chatCitationPersistence } from "./chat-citation-persistence"
import { toChatMessageView } from "./view"
import type { ChatMessage } from "@/infrastructure/db/schema"

describe("chatCitationPersistence", () => {
  it("keeps the parser chunkId while stripping chunk content", () => {
    const citations = chatCitationPersistence.normalizeCitations([
      {
        content: "CHEUNG Hon-lam Gordon 2835 2147",
        chunkType: "page",
        score: 0.8,
        chunkId: "parser_page_1",
        source: {
          documentId: "doc_1",
          sourceFileName: "directory.pdf",
          sectionPath: "Page 3",
        },
      },
    ])

    expect(citations).toEqual([
      {
        chunkType: "page",
        score: 0.8,
        chunkId: "parser_page_1",
        source: {
          documentId: "doc_1",
          sourceFileName: "directory.pdf",
          sectionPath: "Page 3",
        },
      },
    ])
  })

  it("round-trips the chunkId back through persisted message views", () => {
    const message: ChatMessage = {
      id: "message_1",
      threadId: "thread_1",
      role: "assistant",
      content: "Gordon is listed.",
      citations: [
        {
          chunkType: "page",
          score: 0.8,
          chunkId: "parser_page_1",
          source: {
            documentId: "doc_1",
            sourceFileName: "directory.pdf",
            sectionPath: "Page 3",
          },
        },
      ],
      artifacts: null,
      createdAt: new Date("2026-05-10T00:00:00.000Z"),
    }

    const view = toChatMessageView(message)

    expect(view.citations?.[0]).toMatchObject({ chunkId: "parser_page_1" })
  })
})
