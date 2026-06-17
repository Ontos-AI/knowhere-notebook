import { generateObject, NoObjectGeneratedError } from "ai"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildChatDiagramRepairPrompt,
  buildChatDiagramPrompt,
  generateChatDiagramSpec,
  parseChatDiagramRequestBody,
  retrieveAntvChartSkills,
} from "./diagram"

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>()
  return {
    ...actual,
    generateObject: vi.fn(),
  }
})

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
  it("uses the bundled AntV chart visualization skill index without allowing fabricated data", () => {
    const skills = retrieveAntvChartSkills(
      "bar chart category comparison",
      5,
    )
    const prompt = buildChatDiagramPrompt("Cloud revenue was 42.")

    expect(skills[0]?.id).toBe("__info__g2")
    expect(
      skills.some(
        (skill): boolean =>
          skill.tags.includes("bar") ||
          skill.title.toLowerCase().includes("bar") ||
          skill.description.toLowerCase().includes("bar"),
      ),
    ).toBe(true)
    expect(prompt).toContain("@antv/chart-visualization-skills")
    expect(prompt).toContain("Skill: __info__g2")
    expect(prompt).toContain("AntV")
    expect(prompt).toContain("source exactly to \"chart-visualization-skills\"")
    expect(prompt).toContain("Preserve negative values")
    expect(prompt).toContain("core message")
    expect(prompt).toContain("Do not fabricate data")
    expect(prompt).toContain("Cloud revenue was 42.")
  })
})

describe("buildChatDiagramRepairPrompt", () => {
  it("guides failed object generation into a valid chart or no-diagram object", () => {
    const prompt = buildChatDiagramRepairPrompt({
      answer: "Cloud revenue was 42 and Ads revenue was 28.",
      failedOutput: "Here is a chart: ```json {} ```",
    })

    expect(prompt).toContain("Return one valid JSON object only")
    expect(prompt).toContain("\"type\":\"none\"")
    expect(prompt).toContain("\"source\":\"chart-visualization-skills\"")
    expect(prompt).toContain("Previous invalid output")
    expect(prompt).toContain("Cloud revenue was 42")
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

  it("repairs schema-mismatched object output once before returning a chart", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
    vi.mocked(generateObject)
      .mockRejectedValueOnce(makeNoObjectGeneratedError())
      .mockResolvedValueOnce({
        object: {
          type: "column",
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

    expect(generateObject).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generateObject).mock.calls[1]?.[0]).toEqual({
      model: "google/gemini-3-flash",
      schema: expect.any(Object),
      prompt: expect.stringContaining("The previous diagram-generation output"),
    })
    expect(spec).toEqual({
      type: "column",
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

  it("returns a no-diagram response when schema repair also fails", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
    vi.mocked(generateObject).mockRejectedValue(makeNoObjectGeneratedError())

    await expect(
      generateChatDiagramSpec({
        answer: "This answer contains no chartable numbers.",
      }),
    ).resolves.toEqual({
      type: "none",
      reason:
        "No clear chartable data was found. Ask for a table or numeric comparison first.",
    })
    expect(generateObject).toHaveBeenCalledTimes(2)
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

  it("rejects pie charts with non-positive values", async () => {
    process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        type: "pie",
        source: "chart-visualization-skills",
        title: "Mixed Profit Share",
        data: [
          { category: "Loss", value: -5 },
          { category: "Gain", value: 10 },
        ],
      },
    } as Awaited<ReturnType<typeof generateObject>>)

    await expect(
      generateChatDiagramSpec({
        answer: "Loss was -5 and gain was 10.",
      }),
    ).resolves.toEqual({
      type: "none",
      reason:
        "The answer did not contain positive part-to-whole data for a pie chart.",
    })
  })
})

function makeNoObjectGeneratedError(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    cause: new Error("schema mismatch"),
    text: "Here is a chart that does not match the schema.",
    response: {
      id: "response_1",
      modelId: "test-model",
      timestamp: new Date("2026-01-01T00:00:00Z"),
    },
    usage: {
      inputTokens: 1,
      inputTokenDetails: {
        noCacheTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 1,
      outputTokenDetails: {
        textTokens: 1,
        reasoningTokens: 0,
      },
      totalTokens: 2,
    },
    finishReason: "stop",
  })
}
