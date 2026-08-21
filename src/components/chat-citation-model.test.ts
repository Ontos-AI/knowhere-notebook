import { describe, expect, it } from "vitest"

import { chatCitationModel } from "./chat-citation-model"
import type { ChatCitationView, ChatMessageView } from "@/domains/chat/types"

const pageCitation: ChatCitationView = {
  chunkType: "page",
  score: 0.9,
  pageCitationPageNumber: 26,
  source: {
    documentId: "doc_1",
    sourceFileName: "spacex-s1.pdf",
    sectionPath: "Page 26",
  },
}

const samePageCitation: ChatCitationView = {
  ...pageCitation,
  score: 0.88,
}

const otherFileCitation: ChatCitationView = {
  chunkType: "page",
  score: 0.8,
  pageCitationPageNumber: 3,
  source: {
    documentId: "doc_2",
    sourceFileName: "report.pdf",
    sectionPath: "Page 3",
  },
}

describe("chatCitationModel", () => {
  it("labels chips as title/pN and keeps two same-page citations as two identities", () => {
    expect(
      chatCitationModel.getCitationChipLabel(pageCitation, {
        doc_1: "spacex-s1.pdf",
      }),
    ).toBe("spacex-s1.pdf/p26")

    const groups = chatCitationModel.groupCitationsByFile(
      "assistant_1",
      [pageCitation, samePageCitation, otherFileCitation],
      {
        doc_1: "spacex-s1.pdf",
        doc_2: "report.pdf",
      },
    )

    expect(groups).toHaveLength(2)
    expect(groups[0]?.entries.map((entry) => entry.citationId)).toEqual([
      "assistant_1:0",
      "assistant_1:1",
    ])
    expect(groups[0]?.entries.map((entry) => entry.pageNumber)).toEqual([26, 26])
    expect(
      chatCitationModel
        .uniquePageLinkEntries(groups[0]!.entries)
        .map((entry) => entry.pageNumber),
    ).toEqual([26])
    expect(groups[1]?.title).toBe("report.pdf")
  })

  it("uses citation or same-page artifact boxes without inventing a region", () => {
    const citation: ChatCitationView = {
      chunkType: "page",
      score: 0.9,
      pageCitationPageNumber: 4,
      source: {
        documentId: "doc_1",
        sourceFileName: "TSLA-Q4-2025-Update.pdf",
        sectionPath: "Page 4",
      },
    }

    expect(
      chatCitationModel.getListHighlightRegions(
        {
          ...citation,
          highlightRegions: [{ x: 0.12, y: 0.18, w: 0.4, h: 0.1 }],
        },
        [
          {
            type: "image",
            display: true,
            highlightRegions: [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
            citation: {
              chunkType: "page",
              score: 0.8,
              pageCitationPageNumber: 4,
              source: { documentId: "doc_1" },
            },
          },
        ],
      ),
    ).toEqual([{ x: 0.12, y: 0.18, w: 0.4, h: 0.1 }])

    expect(
      chatCitationModel.getListHighlightRegions(citation, [
        {
          type: "image",
          display: true,
          highlightRegions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }],
          citation: {
            chunkType: "page",
            score: 0.8,
            pageCitationPageNumber: 4,
            source: { documentId: "doc_1" },
          },
        },
        {
          type: "image",
          display: true,
          highlightRegions: [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
          citation: {
            chunkType: "page",
            score: 0.7,
            pageCitationPageNumber: 12,
            source: { documentId: "doc_1" },
          },
        },
      ]),
    ).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.15 }])

    expect(chatCitationModel.getListHighlightRegions(citation, [])).toEqual([])
  })

  it("embeds cite markers as links and leaves fenced code unchanged", () => {
    const markdown = chatCitationModel.embedCitationMarkersAsLinks(
      [
        "Revenue grew [[cite:1]] and later [[cite:2]].",
        "",
        "```ts",
        "const value = '[[cite:1]]'",
        "```",
        "",
        "Legacy [Source 1: spacex-s1.pdf / Page 26] remains.",
      ].join("\n"),
      [pageCitation, samePageCitation],
      { doc_1: "spacex-s1.pdf" },
    )

    expect(markdown).toContain(
      "[spacex-s1.pdf/p26](knowhere-cite://1)",
    )
    expect(markdown).toContain(
      "[spacex-s1.pdf/p26](knowhere-cite://2)",
    )
    expect(markdown).toContain("const value = '[[cite:1]]'")
    expect(markdown).not.toContain("[Source 1:")
    expect(markdown).not.toContain("[[cite:1]] and later")
  })

  it("expands grouped cite markers into one chip per index", () => {
    const markdown = chatCitationModel.embedCitationMarkersAsLinks(
      "Total revenue was $24,901 million [[cite:1, 3, 5]].",
      [pageCitation, samePageCitation, otherFileCitation, pageCitation, samePageCitation],
      {
        doc_1: "TSLA-Q4-2025-Update.pdf",
        doc_2: "report.pdf",
      },
    )

    expect(markdown).toContain(
      "[TSLA-Q4-2025-Update.pdf/p26](knowhere-cite://1)",
    )
    expect(markdown).toContain("[report.pdf/p3](knowhere-cite://3)")
    expect(markdown).toContain(
      "[TSLA-Q4-2025-Update.pdf/p26](knowhere-cite://5)",
    )
    expect(markdown).not.toContain("[[cite:")
  })

  it("drops unknown cite markers from display markdown", () => {
    const markdown = chatCitationModel.embedCitationMarkersAsLinks(
      "Unsupported claim [[cite:9]].",
      [pageCitation],
      { doc_1: "spacex-s1.pdf" },
    )

    expect(markdown).toBe("Unsupported claim.")
    expect(markdown).not.toContain("knowhere-cite://9")
  })

  it("strips markers from export markdown and keeps copy labels", () => {
    const message: ChatMessageView = {
      id: "assistant_1",
      role: "assistant",
      content: [
        "Revenue grew [[cite:1]].",
        "",
        "```ts",
        "const  value = 1;",
        "```",
      ].join("\n"),
      citations: [pageCitation],
      artifacts: [
        {
          type: "derived_table",
          display: true,
          title: "Revenue",
          columns: ["Year", "Amount"],
          rows: [["2025", "4.4B"]],
        },
      ],
    }

    expect(chatCitationModel.getExportMarkdown(message)).toBe(
      [
        "Revenue grew.",
        "",
        "```ts",
        "const  value = 1;",
        "```",
        "",
        "### Revenue",
        "| Year | Amount |",
        "| --- | --- |",
        "| 2025 | 4.4B |",
      ].join("\n"),
    )
    expect(chatCitationModel.getCopyMarkdown(message, { doc_1: "spacex-s1.pdf" }))
      .toContain("Revenue grew spacex-s1.pdf/p26.")
    expect(chatCitationModel.getCopyMarkdown(message, { doc_1: "spacex-s1.pdf" }))
      .toContain("const  value = 1;")
  })

  it("keeps knowhere cite hrefs out of the default markdown URL transform", () => {
    expect(
      chatCitationModel.transformMarkdownUrl("knowhere-cite://2", () => ""),
    ).toBe("knowhere-cite://2")
    expect(chatCitationModel.parseKnowhereCiteIndex("knowhere-cite://2")).toBe(2)
    expect(chatCitationModel.isKnowhereCiteHref("https://example.com")).toBe(
      false,
    )
  })
})
