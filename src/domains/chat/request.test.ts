import { describe, expect, it } from "vitest"

import { parseChatRequestBody } from "./request"

describe("parseChatRequestBody", () => {
  it("parses retrieval params with defaults preserved when absent", () => {
    const result = parseChatRequestBody({
      message: "Question?",
      excludedSourceIds: ["source_1"],
    })

    expect(result).toEqual({
      ok: true,
      value: {
        question: "Question?",
        excludedSourceIds: ["source_1"],
      },
    })
  })

  it("passes through valid retrieval params", () => {
    const result = parseChatRequestBody({
      message: "Question?",
      excludedSourceIds: [],
      retrievalParams: {
        rerank: false,
        internalRecallK: 40,
        topK: 6,
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        question: "Question?",
        excludedSourceIds: [],
        retrievalParams: {
          rerank: false,
          internalRecallK: 40,
          topK: 6,
        },
      },
    })
  })

  it("clamps out-of-range retrieval params and drops invalid types", () => {
    const result = parseChatRequestBody({
      message: "Question?",
      excludedSourceIds: [],
      retrievalParams: {
        internalRecallK: 500,
        topK: 0,
      },
    })

    expect(result).toEqual({
      ok: true,
      value: {
        question: "Question?",
        excludedSourceIds: [],
        retrievalParams: {
          internalRecallK: 50,
          topK: 1,
        },
      },
    })
  })

  it("rejects the request when a retrieval param has the wrong type", () => {
    const result = parseChatRequestBody({
      message: "Question?",
      excludedSourceIds: [],
      retrievalParams: {
        rerank: "yes" as unknown as boolean,
      },
    })

    expect(result).toEqual({
      ok: false,
      message: "Enter a question before sending.",
      status: 400,
    })
  })
})
