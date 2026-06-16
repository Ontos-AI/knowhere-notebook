import { generateObject } from "ai"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildChatDiagramPrompt,
  generateChatDiagramSpec,
  parseChatDiagramRequestBody,
} from "./diagram"

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}))

describe("parseChatDiagramRequestBody", () => {
  it("accepts trimmed answer content", () => {
    expect(parseChatDiagramRequestBody({ answer: "  Revenue was 42.  " }))
      .toEqual({
        ok: true,
        value: {
          answer: "Revenue was 42.",
        },
      })
  })

  it("rejects empty answer content", () => {
    expect(parseChatDiagramRequestBody({ answer: " " })).toEqual({
      ok: false,
      status: 400,
      message: "Answer content is required before creating a diagram.",
    })
  })
})

describe("buildChatDiagramPrompt", () => {
  it("uses the chart-visualization skill rules without allowing fabricated data", () => {
    const prompt = buildChatDiagramPrompt("Cloud revenue was 42.")

    expect(prompt).toContain("chart-visualization skill")
    expect(prompt).toContain("source exactly to \"chart-visualization-skills\"")
    expect(prompt).toContain("Do not fabricate data")
    expect(prompt).toContain("Cloud revenue was 42.")
  })
})

describe("generateChatDiagramSpec", () => {
  afterEach(() => {
    delete process.env.AI_GATEWAY_API_KEY
    vi.mocked(generateObject).mockReset()
  })

  it("generates an AntV-compatible chart spec", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        type: "bar",
        source: "chart-visualization-skills",
        title: "Revenue by Segment",
        data: [
          { category: "Cloud", value: 42 },
          { category: "Ads", value: 28 },
        ],
      },
    } as Awaited<ReturnType<typeof generateObject>>)

    const spec = await generateChatDiagramSpec({
      answer: "Cloud revenue was 42 and Ads revenue was 28.",
    })

    expect(generateObject).toHaveBeenCalledWith({
      model: "google/gemini-3-flash",
      schema: expect.any(Object),
      prompt: expect.stringContaining("Cloud revenue was 42"),
    })
    expect(spec).toEqual({
      type: "bar",
      source: "chart-visualization-skills",
      title: "Revenue by Segment",
      axisXTitle: undefined,
      axisYTitle: undefined,
      data: [
        { category: "Cloud", time: undefined, value: 42 },
        { category: "Ads", time: undefined, value: 28 },
      ],
    })
  })

  it("normalizes sparse chart specs into no-diagram responses", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        type: "bar",
        source: "chart-visualization-skills",
        title: "Only one number",
        data: [{ category: "Cloud", value: 42 }],
      },
    } as Awaited<ReturnType<typeof generateObject>>)

    await expect(
      generateChatDiagramSpec({ answer: "Cloud revenue was 42." }),
    ).resolves.toEqual({
      type: "none",
      reason: "The answer did not contain enough concrete data for a chart.",
    })
  })
})
