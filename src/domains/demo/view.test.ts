import { describe, expect, it } from "vitest"

import { chatCitationModel } from "@/components/chat-citation-model"
import { demoView } from "@/domains/demo/view"
import type { DemoCatalog, DemoCitation, DemoSource } from "@/integrations/knowhere-demo"

describe("demoView.toChatMessages", () => {
  it("uses the live citation mapper so demo answers render title/pN chips", () => {
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
    expect(
      chatCitationModel.getCitationChipLabel(assistant!.citations![0]!, {}),
    ).toBe("TSLA-Q4-2025-Update.pdf/p12")
  })

  it("resolves page chips from catalog page_nums when the explicit page field is omitted", () => {
    const messages = demoView.toChatMessages(
      makeCatalog({
        title: "spacex-s1.pdf",
        answer:
          "The filing says SpaceX operates about 9,600 Starlink satellites. [[cite:1]]",
        citations: [
          makeCitation({
            demoSourceId: "demo-spacex-s1",
            canonicalDocumentId: "demo-doc-spacex-s1",
            pageCitationPageNumber: undefined,
            pageCitationAssetUrl: undefined,
            pageNums: [28],
            source: {
              documentId: "demo-doc-spacex-s1",
              sourceFileName: "spacex-s1.pdf",
              sectionPath: "spacex-s1.pdf/Root",
            },
          }),
        ],
      }),
    )
    const assistant = messages.find((message) => message.role === "assistant")

    expect(assistant?.citations?.[0]?.pageCitationPageNumber).toBe(28)
    expect(
      chatCitationModel.getCitationChipLabel(assistant!.citations![0]!, {}),
    ).toBe("spacex-s1.pdf/p28")
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
  readonly title?: string
  readonly answer: string
  readonly citations: readonly DemoCitation[]
}): DemoCatalog {
  return {
    officialLibrary: { categories: [], sources: [] },
    sources: [makeDemoSource(input)],
  }
}

function makeDemoSource(input: {
  readonly title?: string
  readonly answer: string
  readonly citations: readonly DemoCitation[]
}): DemoSource {
  return {
    demoSourceId: "demo-tsla-q4-2025",
    canonicalDocumentId: "demo-doc-tsla-q4-2025",
    title: input.title ?? "TSLA-Q4-2025-Update.pdf",
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
