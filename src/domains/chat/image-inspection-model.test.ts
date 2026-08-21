import {
  generateObject,
  generateText,
  NoObjectGeneratedError,
  UnsupportedFunctionalityError,
} from "ai"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  generateImageInspectionModelResult,
  isRecoverableStructuredOutputError,
  parseStructuredInspectionText,
  salvageAnalysisFromFailedStructuredText,
} from "./image-inspection-model"

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>()
  return {
    ...original,
    generateObject: vi.fn(),
    generateText: vi.fn(),
  }
})

describe("image inspection model", () => {
  const assets = [
    {
      ref: "asset:page-1",
      label: "page 1",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    },
  ] as const

  beforeEach(() => {
    vi.mocked(generateObject).mockReset()
    vi.mocked(generateText).mockReset()
  })

  it("returns structured analysis and pages on success", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        analysis: "The page states approval is required.",
        pages: [
          {
            ref: "asset:page-1",
            regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
          },
        ],
      },
    } as Awaited<ReturnType<typeof generateObject>>)

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "When is approval required?",
      assets,
    })

    expect(result).toEqual({
      analysis: "The page states approval is required.",
      pages: [
        {
          ref: "asset:page-1",
          regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
        },
      ],
      source: "structured",
    })
    expect(generateText).not.toHaveBeenCalled()
  })

  it("batches more than six images while preserving every page region", async () => {
    const sevenAssets = Array.from({ length: 7 }, (_, index) => ({
      ref: `asset:page-${index + 1}`,
      label: `page ${index + 1}`,
      body: new Uint8Array([index + 1]),
      contentType: "image/png",
    }))
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: {
          analysis: "Pages one through six.",
          pages: sevenAssets.slice(0, 6).map((asset) => ({
            ref: asset.ref,
            regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
          })),
        },
      } as Awaited<ReturnType<typeof generateObject>>)
      .mockResolvedValueOnce({
        object: {
          analysis: "Page seven.",
          pages: [
            {
              ref: sevenAssets[6]!.ref,
              regions: [{ x: 0.4, y: 0.5, w: 0.2, h: 0.1 }],
            },
          ],
        },
      } as Awaited<ReturnType<typeof generateObject>>)

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "Locate evidence on every cited page.",
      assets: sevenAssets,
    })

    expect(generateObject).toHaveBeenCalledTimes(2)
    expect(result.analysis).toBe("Pages one through six.\n\nPage seven.")
    expect(result.pages).toHaveLength(7)
    expect(result.pages[6]).toEqual({
      ref: "asset:page-7",
      regions: [{ x: 0.4, y: 0.5, w: 0.2, h: 0.1 }],
    })
    expect(result.source).toBe("structured")
  })

  it("salvages valid structured JSON from failed generateObject text", async () => {
    vi.mocked(generateObject).mockRejectedValue(
      makeNoObjectGeneratedError(
        JSON.stringify({
          analysis: "Visible caption says 5000 yuan.",
          pages: [
            {
              ref: "asset:page-1",
              regions: [{ x: 0.2, y: 0.3, w: 0.4, h: 0.1 }],
            },
          ],
        }),
      ),
    )

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "What amount is shown?",
      assets,
    })

    expect(result).toEqual({
      analysis: "Visible caption says 5000 yuan.",
      pages: [
        {
          ref: "asset:page-1",
          regions: [{ x: 0.2, y: 0.3, w: 0.4, h: 0.1 }],
        },
      ],
      source: "structured_text",
    })
    expect(generateText).not.toHaveBeenCalled()
  })

  it("salvages analysis-only when failed structured text has analysis but invalid pages", async () => {
    vi.mocked(generateObject).mockRejectedValue(
      makeNoObjectGeneratedError(
        '{"analysis":"Visible caption says 5000 yuan.","pages":[{"ref":"bad"}]}',
      ),
    )

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "What amount is shown?",
      assets,
    })

    expect(result).toEqual({
      analysis: "Visible caption says 5000 yuan.",
      pages: [],
      source: "analysis_fallback",
    })
    expect(generateText).not.toHaveBeenCalled()
  })

  it("falls back to generateText when structured output fails without salvageable analysis", async () => {
    vi.mocked(generateObject).mockRejectedValue(
      makeNoObjectGeneratedError('{"pages":[]}'),
    )
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "not-json",
      } as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({
        text: "The image shows a fee table.",
      } as Awaited<ReturnType<typeof generateText>>)

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "What does the table show?",
      assets,
    })

    expect(result).toEqual({
      analysis: "The image shows a fee table.",
      pages: [],
      source: "analysis_fallback",
    })
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it("uses generateText JSON when the model does not support structured object generation", async () => {
    vi.mocked(generateObject).mockRejectedValue(
      new UnsupportedFunctionalityError({
        functionality: "object generation",
      }),
    )
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        analysis: "Approval is required on City land.",
        pages: [
          {
            ref: "asset:page-1",
            regions: [{ x: 0.05, y: 0.1, w: 0.9, h: 0.2 }],
          },
        ],
      }),
    } as Awaited<ReturnType<typeof generateText>>)

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "When is approval required?",
      assets,
    })

    expect(result).toEqual({
      analysis: "Approval is required on City land.",
      pages: [
        {
          ref: "asset:page-1",
          regions: [{ x: 0.05, y: 0.1, w: 0.9, h: 0.2 }],
        },
      ],
      source: "structured_text",
    })
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it("falls back to analysis-only text when unsupported structured models cannot emit JSON", async () => {
    vi.mocked(generateObject).mockRejectedValue(
      new UnsupportedFunctionalityError({
        functionality: "object generation",
      }),
    )
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "not-json",
      } as Awaited<ReturnType<typeof generateText>>)
      .mockResolvedValueOnce({
        text: "The diagram labels a 40km/h zone.",
      } as Awaited<ReturnType<typeof generateText>>)

    const result = await generateImageInspectionModelResult({
      workspaceId: "ws_1",
      question: "What speed is shown?",
      assets,
    })

    expect(result).toEqual({
      analysis: "The diagram labels a 40km/h zone.",
      pages: [],
      source: "analysis_fallback",
    })
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it("rethrows non-schema model failures without falling back", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("network down"))

    await expect(
      generateImageInspectionModelResult({
        workspaceId: "ws_1",
        question: "What does the table show?",
        assets,
      }),
    ).rejects.toThrow("network down")
    expect(generateText).not.toHaveBeenCalled()
  })

  it("classifies recoverable structured-output errors", () => {
    expect(
      isRecoverableStructuredOutputError(
        new UnsupportedFunctionalityError({
          functionality: "object generation",
        }),
      ),
    ).toBe(true)
    expect(
      isRecoverableStructuredOutputError(makeNoObjectGeneratedError("{}")),
    ).toBe(true)
    expect(isRecoverableStructuredOutputError(new Error("network down"))).toBe(
      false,
    )
  })

  it("parses and salvages structured inspection text", () => {
    expect(
      parseStructuredInspectionText(
        JSON.stringify({
          analysis: "Box A is labeled red.",
          pages: [{ ref: "asset:page-1", regions: [{ x: 0, y: 0, w: 1, h: 1 }] }],
        }),
      ),
    ).toEqual({
      analysis: "Box A is labeled red.",
      pages: [{ ref: "asset:page-1", regions: [{ x: 0, y: 0, w: 1, h: 1 }] }],
    })
    expect(
      salvageAnalysisFromFailedStructuredText(
        'prefix {"analysis":"Box A is labeled red."} suffix',
      ),
    ).toBe("Box A is labeled red.")
    expect(salvageAnalysisFromFailedStructuredText("Plain OCR notes.")).toBe(
      "Plain OCR notes.",
    )
    expect(salvageAnalysisFromFailedStructuredText('{"pages":[]}')).toBeNull()
    expect(salvageAnalysisFromFailedStructuredText("")).toBeNull()
  })
})

function makeNoObjectGeneratedError(text: string): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    cause: new Error("schema mismatch"),
    text,
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
