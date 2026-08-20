import { describe, expect, it } from "vitest"

import { demoView } from "@/domains/demo/view"
import type { DemoCatalog, DemoCitation, DemoSource } from "@/integrations/knowhere-demo"

describe("demoView.toChatMessages", () => {
  it("embeds cite markers and page metadata so demo answers render title/pN chips", () => {
    const messages = demoView.toChatMessages(
      makeCatalog({
        answer:
          "Tesla entered an agreement to invest about $2 billion in xAI. [[cite:1]]",
        citations: [makeCitation({ pageCitationPageNumber: 12 })],
      }),
    )
    const assistant = messages.find((message) => message.role === "assistant")

    expect(assistant?.content).toContain("[[cite:1]]")
    expect(assistant?.citations).toEqual([
      expect.objectContaining({
        pageCitationPageNumber: 12,
        pageCitationAssetUrl:
          "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-12.png",
        source: expect.objectContaining({
          sourceFileName: "TSLA-Q4-2025-Update.pdf",
          sectionPath: "TSLA-Q4-2025-Update.pdf/OTHER UPDATES",
        }),
      }),
    ])
  })

  it("appends cite markers when the catalog answer still omits them", () => {
    const messages = demoView.toChatMessages(
      makeCatalog({
        answer: "Tesla entered an agreement to invest about $2 billion in xAI.",
        citations: [makeCitation({ pageCitationPageNumber: 12 })],
      }),
    )
    const assistant = messages.find((message) => message.role === "assistant")

    expect(assistant?.content).toBe(
      "Tesla entered an agreement to invest about $2 billion in xAI. [[cite:1]]",
    )
  })
})

function makeCatalog(input: {
  readonly answer: string
  readonly citations: readonly DemoCitation[]
}): DemoCatalog {
  return {
    officialLibrary: { categories: [], sources: [] },
    sources: [makeDemoSource(input)],
  }
}

function makeDemoSource(input: {
  readonly answer: string
  readonly citations: readonly DemoCitation[]
}): DemoSource {
  return {
    demoSourceId: "demo-tsla-q4-2025",
    canonicalDocumentId: "demo-doc-tsla-q4-2025",
    title: "TSLA-Q4-2025-Update.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "ready",
    chunkCount: 71,
    originalFile: {
      url: "/api/v1/demo/sources/demo-tsla-q4-2025/original",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      canDownload: false,
    },
    examples: [
      {
        id: "demo-tsla-q4-2025-xai",
        question: "What does the document say about Tesla's xAI investment?",
        answer: input.answer,
        citations: input.citations,
      },
    ],
  }
}

function makeCitation(
  overrides: Partial<DemoCitation> = {},
): DemoCitation {
  return {
    demoSourceId: "demo-tsla-q4-2025",
    canonicalDocumentId: "demo-doc-tsla-q4-2025",
    canonicalChunkId: "demo-tsla-q4-2025:chunk",
    chunkId: "chunk",
    chunkType: "page",
    content: "Tesla entered into an agreement to invest approximately",
    pageCitationAssetUrl:
      "/api/demo-sources/demo-tsla-q4-2025/assets/page_citation_assets/page-12.png",
    source: {
      documentId: "demo-doc-tsla-q4-2025",
      sourceFileName: "TSLA-Q4-2025-Update.pdf",
      sectionPath: "TSLA-Q4-2025-Update.pdf/OTHER UPDATES",
    },
    ...overrides,
  }
}
