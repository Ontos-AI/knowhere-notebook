import { describe, expect, it } from "vitest"

import {
  captureOutputSchema,
  capturedObservationSchema,
} from "./observation-types"

describe("capturedObservationSchema", () => {
  it("accepts a full observation", () => {
    const parsed = capturedObservationSchema.parse({
      signal: "看重毛利率",
      evidenceQuote: "毛利率是核心",
      subjectHint: "毛利率",
      confidence: 0.9,
    })
    expect(parsed.subjectHint).toBe("毛利率")
    expect(parsed).not.toHaveProperty("kindHint")
  })

  it("coerces null subjectHint to undefined (single preprocess)", () => {
    const parsed = capturedObservationSchema.parse({
      signal: "长期持有",
      evidenceQuote: "我做长期投资",
      subjectHint: null,
      confidence: 1,
    })
    expect(parsed.subjectHint).toBeUndefined()
  })

  it("strips unknown kindHint if the model still emits it", () => {
    const parsed = capturedObservationSchema.parse({
      signal: "看重毛利率",
      evidenceQuote: "毛利率是核心",
      kindHint: "indicator",
      confidence: 0.9,
    })
    expect(parsed).not.toHaveProperty("kindHint")
  })

  it("rejects empty signal or evidenceQuote", () => {
    expect(() =>
      capturedObservationSchema.parse({
        signal: "",
        evidenceQuote: "x",
        confidence: 0.5,
      }),
    ).toThrow()
    expect(() =>
      capturedObservationSchema.parse({
        signal: "x",
        evidenceQuote: "",
        confidence: 0.5,
      }),
    ).toThrow()
  })
})

describe("captureOutputSchema", () => {
  it("defaults missing observations to empty array", () => {
    expect(captureOutputSchema.parse({})).toEqual({ observations: [] })
  })

  it("parses a batch of observations", () => {
    const parsed = captureOutputSchema.parse({
      observations: [
        {
          signal: "跟踪英伟达",
          evidenceQuote: "英伟达一直在跟踪",
          subjectHint: "英伟达",
          confidence: 0.8,
        },
      ],
    })
    expect(parsed.observations).toHaveLength(1)
    expect(parsed.observations[0]?.subjectHint).toBe("英伟达")
    expect(parsed.observations[0]).not.toHaveProperty("kindHint")
  })
})
