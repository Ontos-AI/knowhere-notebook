import {
  APICallError,
  generateObject,
  generateText,
  NoObjectGeneratedError,
  UnsupportedFunctionalityError,
} from "ai"
import { z } from "zod"

import { CHAT_MODEL } from "@/lib/ai"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

const VISION_MODEL = process.env.VISION_MODEL ?? CHAT_MODEL
const IMAGE_INSPECTION_BATCH_SIZE = 6

export const imageInspectionResultSchema = z.object({
  analysis: z.string(),
  pages: z
    .array(
      z.object({
        ref: z.string().min(1),
        regions: z
          .array(
            z.object({
              x: z.number(),
              y: z.number(),
              w: z.number(),
              h: z.number(),
            }),
          )
          .max(12),
      }),
    )
    .max(6)
    .default([]),
})

export type ImageInspectionModelPage = z.infer<
  typeof imageInspectionResultSchema
>["pages"][number]

export type ImageInspectionModelAsset = {
  readonly ref: string
  readonly label: string
  readonly body: Uint8Array
  readonly contentType: string
}

export type ImageInspectionModelResult = {
  readonly analysis: string
  readonly pages: readonly ImageInspectionModelPage[]
  readonly source: "structured" | "structured_text" | "analysis_fallback"
}

/**
 * Prefer native structured output (analysis + highlight boxes).
 * If the model/provider cannot do generateObject, degrade through:
 * 1) salvage/parse JSON from failed text
 * 2) generateText + JSON prompt (may still yield boxes)
 * 3) analysis-only generateText
 * so inspectImage still succeeds.
 */
export async function generateImageInspectionModelResult(input: {
  readonly workspaceId: string
  readonly question: string
  readonly assets: readonly ImageInspectionModelAsset[]
}): Promise<ImageInspectionModelResult> {
  if (input.assets.length <= IMAGE_INSPECTION_BATCH_SIZE) {
    return generateImageInspectionBatchResult(input)
  }

  const results: ImageInspectionModelResult[] = []
  for (
    let index = 0;
    index < input.assets.length;
    index += IMAGE_INSPECTION_BATCH_SIZE
  ) {
    results.push(
      await generateImageInspectionBatchResult({
        ...input,
        assets: input.assets.slice(index, index + IMAGE_INSPECTION_BATCH_SIZE),
      }),
    )
  }

  return {
    analysis: results
      .map((result) => result.analysis.trim())
      .filter(Boolean)
      .join("\n\n"),
    pages: results.flatMap((result) => result.pages),
    source: getCombinedInspectionSource(results),
  }
}

async function generateImageInspectionBatchResult(input: {
  readonly workspaceId: string
  readonly question: string
  readonly assets: readonly ImageInspectionModelAsset[]
}): Promise<ImageInspectionModelResult> {
  let structuredFailureText: string | undefined

  try {
    const response = await generateObject({
      model: VISION_MODEL,
      schema: imageInspectionResultSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildImageInspectionStructuredPrompt({
                question: input.question,
                assets: input.assets,
              }),
            },
            ...toImageParts(input.assets),
          ],
        },
      ],
    })

    return {
      analysis: response.object.analysis.trim(),
      pages: response.object.pages,
      source: "structured",
    }
  } catch (error) {
    if (!isRecoverableStructuredOutputError(error)) {
      logger.warn("chat: image inspection model call failed", {
        workspaceId: input.workspaceId,
        model: VISION_MODEL,
        inspectedCount: input.assets.length,
        error: summarizeUnknownError(error),
      })
      throw error
    }

    structuredFailureText = getStructuredFailureText(error)
    logger.warn("chat: image inspection structured output unavailable; falling back", {
      workspaceId: input.workspaceId,
      model: VISION_MODEL,
      inspectedCount: input.assets.length,
      generatedTextLength: structuredFailureText?.length ?? 0,
      error: summarizeUnknownError(error),
    })
  }

  const salvagedStructured = parseStructuredInspectionText(structuredFailureText)
  if (salvagedStructured) {
    return {
      ...salvagedStructured,
      source: "structured_text",
    }
  }

  const salvagedAnalysis = salvageAnalysisFromFailedStructuredText(
    structuredFailureText,
  )
  if (salvagedAnalysis !== null) {
    return {
      analysis: salvagedAnalysis,
      pages: [],
      source: "analysis_fallback",
    }
  }

  try {
    const jsonTextResponse = await generateText({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildImageInspectionStructuredPrompt({
                question: input.question,
                assets: input.assets,
              }),
            },
            ...toImageParts(input.assets),
          ],
        },
      ],
      experimental_include: {
        requestBody: false,
        responseBody: false,
      },
    })

    const parsedFromText = parseStructuredInspectionText(jsonTextResponse.text)
    if (parsedFromText) {
      return {
        ...parsedFromText,
        source: "structured_text",
      }
    }

    // Structured prompt asked for JSON; only keep an analysis field from JSON,
    // never treat arbitrary freeform text as a successful inspection here.
    const analysisFromJsonAttempt = salvageAnalysisFieldFromJsonText(
      jsonTextResponse.text,
    )
    if (analysisFromJsonAttempt !== null) {
      return {
        analysis: analysisFromJsonAttempt,
        pages: [],
        source: "analysis_fallback",
      }
    }
  } catch (error) {
    logger.warn("chat: image inspection structured-text fallback failed", {
      workspaceId: input.workspaceId,
      model: VISION_MODEL,
      inspectedCount: input.assets.length,
      error: summarizeUnknownError(error),
    })
  }

  try {
    const response = await generateText({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildImageInspectionAnalysisPrompt({
                question: input.question,
                assets: input.assets,
              }),
            },
            ...toImageParts(input.assets),
          ],
        },
      ],
      experimental_include: {
        requestBody: false,
        responseBody: false,
      },
    })

    return {
      analysis: response.text.trim(),
      pages: [],
      source: "analysis_fallback",
    }
  } catch (error) {
    logger.warn("chat: image inspection analysis fallback failed", {
      workspaceId: input.workspaceId,
      model: VISION_MODEL,
      inspectedCount: input.assets.length,
      error: summarizeUnknownError(error),
    })
    throw error
  }
}

function getCombinedInspectionSource(
  results: readonly ImageInspectionModelResult[],
): ImageInspectionModelResult["source"] {
  if (results.every((result) => result.source === "structured")) {
    return "structured"
  }
  if (results.some((result) => result.source === "analysis_fallback")) {
    return "analysis_fallback"
  }
  return "structured_text"
}

export function isRecoverableStructuredOutputError(error: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(error)) return true
  if (UnsupportedFunctionalityError.isInstance(error)) return true

  if (APICallError.isInstance(error)) {
    const haystack = [
      error.message,
      error.data === undefined ? "" : JSON.stringify(error.data),
      typeof error.responseBody === "string" ? error.responseBody : "",
    ]
      .join(" ")
      .toLowerCase()

    return (
      /response[_\s-]?format/.test(haystack) ||
      /json[_\s-]?schema/.test(haystack) ||
      /structured[_\s-]?output/.test(haystack) ||
      /tool[_\s-]?choice/.test(haystack) ||
      /unsupported/.test(haystack)
    )
  }

  return false
}

export function buildImageInspectionStructuredPrompt(input: {
  readonly question: string
  readonly assets: readonly Pick<ImageInspectionModelAsset, "ref" | "label">[]
}): string {
  return [
    "Inspect the attached Notebook image assets selected from retrieved Knowhere evidence.",
    "Answer the inspection question using concise visual observations only.",
    "Use the provided refs to identify images. Do not include image URLs.",
    "If OCR text is unclear, say it is unclear instead of guessing.",
    "Do not create citations. The calling agent will cite the original retrieved asset refs.",
    "",
    "Also return answer provenance boxes for every page that supports the answer.",
    "One answer may span multiple pages; each page may have one or more regions.",
    "Coordinate system: origin top-left; x,y,w,h are fractions of image width/height in [0,1].",
    "Do not add labels or captions for regions. Omit pages with no useful region.",
    "",
    "Return ONLY valid JSON with this shape:",
    '{"analysis":"string","pages":[{"ref":"asset:page-12","regions":[{"x":0,"y":0,"w":0.2,"h":0.1}]}]}',
    "",
    "Inspection question:",
    input.question,
    "",
    "Images:",
    ...input.assets.map((asset) => `- ref=${asset.ref} label=${asset.label}`),
  ].join("\n")
}

export function buildImageInspectionAnalysisPrompt(input: {
  readonly question: string
  readonly assets: readonly Pick<ImageInspectionModelAsset, "ref" | "label">[]
}): string {
  return [
    "Inspect the attached Notebook image assets selected from retrieved Knowhere evidence.",
    "Answer the inspection question using concise visual observations only.",
    "Use the provided refs and labels to identify images. Do not include image URLs.",
    "If OCR text is unclear, say it is unclear instead of guessing.",
    "Do not create citations. The calling agent will cite the original retrieved asset refs.",
    "",
    "Inspection question:",
    input.question,
    "",
    "Images:",
    ...input.assets.map((asset) => `- ref=${asset.ref} label=${asset.label}`),
  ].join("\n")
}

export function parseStructuredInspectionText(
  text: string | undefined,
): { readonly analysis: string; readonly pages: ImageInspectionModelPage[] } | null {
  const trimmed = text?.trim()
  if (!trimmed) return null

  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) return null

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    const result = imageInspectionResultSchema.safeParse(parsed)
    if (!result.success) return null

    const analysis = result.data.analysis.trim()
    if (!analysis) return null

    return {
      analysis,
      pages: result.data.pages,
    }
  } catch {
    return null
  }
}

export function salvageAnalysisFieldFromJsonText(
  text: string | undefined,
): string | null {
  const trimmed = text?.trim()
  if (!trimmed) return null

  try {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start < 0 || end <= start) return null

    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("analysis" in parsed) ||
      typeof (parsed as { analysis: unknown }).analysis !== "string"
    ) {
      return null
    }

    const analysis = (parsed as { analysis: string }).analysis.trim()
    return analysis.length > 0 ? analysis : null
  } catch {
    return null
  }
}

export function salvageAnalysisFromFailedStructuredText(
  text: string | undefined,
): string | null {
  const structured = parseStructuredInspectionText(text)
  if (structured) return structured.analysis

  const fromJson = salvageAnalysisFieldFromJsonText(text)
  if (fromJson !== null) return fromJson

  const trimmed = text?.trim()
  if (!trimmed) return null

  // Reject obvious raw JSON blobs without a usable analysis field.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return null
  }

  return trimmed
}

function getStructuredFailureText(error: unknown): string | undefined {
  if (NoObjectGeneratedError.isInstance(error)) {
    return error.text
  }
  return undefined
}

function toImageParts(assets: readonly ImageInspectionModelAsset[]) {
  return assets.map((asset) => ({
    type: "image" as const,
    image: asset.body,
    mediaType: asset.contentType,
  }))
}
