import { describe, expect, it } from "vitest"
import type { RetrievalResult } from "@ontos-ai/knowhere-sdk"

import { toChatCitationViews } from "./citations"

describe("toChatCitationViews", () => {
  it("extracts first citation description for each generated source label", () => {
    const firstResult = makeRetrievalResult({
      source: {
        documentId: "doc_1",
        sourceFileName: "notes.txt",
        sectionPath: "Revenue",
      },
    })
    const secondResult = makeRetrievalResult({
      content: "Gross margin improved.",
      source: {
        documentId: "doc_2",
        sourceFileName: "notes.txt",
        sectionPath: "Margin",
      },
    })

    const citations = toChatCitationViews(
      [firstResult, secondResult],
      "Revenue improved [Source 1: revenue growth]. Margins expanded [Source 2: margin expansion]. Later repeat [Source 1: duplicate].",
    )

    expect(citations).toEqual([
      { ...firstResult, description: "revenue growth" },
      { ...secondResult, description: "margin expansion" },
    ])
  })
})

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
  }
}
