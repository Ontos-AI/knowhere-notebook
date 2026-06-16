import { generateObject } from "ai"
import { z } from "zod"

import { CHAT_MODEL } from "@/lib/ai"
import { logger } from "@/lib/logger"

const MAX_ANSWER_CHARS = 12_000
const MAX_REASON_CHARS = 240

const noDiagramSchema = z.object({
  type: z.literal("none"),
  reason: z.string().min(1).max(MAX_REASON_CHARS),
})

const chartDiagramSchema = z.object({
  type: z.enum(["bar", "column", "line", "pie"]),
  source: z.literal("chart-visualization-skills"),
  title: z.string().min(1).max(120),
  axisXTitle: z.string().min(1).max(80).optional(),
  axisYTitle: z.string().min(1).max(80).optional(),
  data: z
    .array(
      z.object({
        category: z.string().min(1).max(80).optional(),
        time: z.string().min(1).max(80).optional(),
        value: z.number(),
      }),
    )
    .min(2)
    .max(12),
})

export const chatDiagramSpecSchema = z.union([
  noDiagramSchema,
  chartDiagramSchema,
])

export type ChatDiagramSpec = z.infer<typeof chatDiagramSpecSchema>
export type ChatDiagramChartSpec = z.infer<typeof chartDiagramSchema>

export type ParseChatDiagramRequestResult =
  | {
      readonly ok: true
      readonly value: {
        readonly answer: string
      }
    }
  | {
      readonly ok: false
      readonly status: 400
      readonly message: string
    }

export function parseChatDiagramRequestBody(
  body: unknown,
): ParseChatDiagramRequestResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      message: "Answer content is required before creating a diagram.",
    }
  }

  const answer = (body as { readonly answer?: unknown }).answer
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      message: "Answer content is required before creating a diagram.",
    }
  }

  return {
    ok: true,
    value: {
      answer: answer.trim().slice(0, MAX_ANSWER_CHARS),
    },
  }
}

export async function generateChatDiagramSpec(input: {
  readonly answer: string
}): Promise<ChatDiagramSpec> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "AI_GATEWAY_API_KEY environment variable is required. Set it in your .env.local file.",
    )
  }

  const prompt = buildChatDiagramPrompt(input.answer)
  logger.info("chat-diagram: llm request", {
    model: CHAT_MODEL,
    promptCharLength: prompt.length,
  })
  const response = await generateObject({
    model: CHAT_MODEL,
    schema: chatDiagramSpecSchema,
    prompt,
  })
  const spec = normalizeChatDiagramSpec(response.object)
  logger.info("chat-diagram: llm response", {
    model: CHAT_MODEL,
    type: spec.type,
    dataPointCount: spec.type === "none" ? 0 : spec.data.length,
  })
  return spec
}

export function buildChatDiagramPrompt(answer: string): string {
  return [
    "You are responsible for turning Notebook answer content into one visualization opportunity.",
    "Use the chart-visualization skill methodology from antvis/chart-visualization-skills.",
    "",
    "Workflow:",
    "1. Detect whether the answer contains explicit, concrete data suitable for a chart.",
    "2. Extract clean structured data from the answer without changing meaning.",
    "3. Select the simplest appropriate chart type.",
    "4. Return one JSON object matching the requested schema.",
    "",
    "Chart selection:",
    "- For trends over time, use line.",
    "- For comparisons across categories, use bar or column.",
    "- For part-to-whole relationships, use pie only when there are few categories.",
    "",
    "Rules:",
    "- Do not create a chart when there is no explicit concrete data.",
    "- Do not fabricate data, fill missing values, infer hidden numbers, or change units.",
    "- Use type none with a short reason when a diagram should not be created.",
    '- For charts, set source exactly to "chart-visualization-skills".',
    "- For bar, column, and pie data, use category + value.",
    "- For line data, use time + value.",
    "- Select only one chart: the one with the highest information value.",
    "- Output JSON only, with no explanations and no Markdown.",
    "",
    "Answer content:",
    answer,
  ].join("\n")
}

function normalizeChatDiagramSpec(spec: ChatDiagramSpec): ChatDiagramSpec {
  if (spec.type === "none") {
    return {
      type: "none",
      reason: spec.reason.trim().slice(0, MAX_REASON_CHARS),
    }
  }

  const data = spec.data
    .map((datum) => ({
      ...datum,
      category: normalizeLabel(datum.category),
      time: normalizeLabel(datum.time),
    }))
    .filter((datum) => Number.isFinite(datum.value))
    .filter((datum): boolean =>
      spec.type === "line"
        ? Boolean(datum.time)
        : Boolean(datum.category),
    )
    .slice(0, 12)

  if (data.length < 2) {
    return {
      type: "none",
      reason: "The answer did not contain enough concrete data for a chart.",
    }
  }

  return {
    ...spec,
    title: spec.title.trim(),
    axisXTitle: normalizeLabel(spec.axisXTitle),
    axisYTitle: normalizeLabel(spec.axisYTitle),
    data,
  }
}

function normalizeLabel(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}
