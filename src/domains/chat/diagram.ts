import { generateObject } from "ai"
import { retrieve, type Skill } from "@antv/chart-visualization-skills"
import { z } from "zod"

import { CHAT_MODEL } from "@/lib/ai"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

const MAX_ANSWER_CHARS = 12_000
const MAX_REASON_CHARS = 240
const ANTV_CHART_LIBRARY = "g2"
const ANTV_CHART_SKILL_TOP_K = 5
const MAX_ANTV_SKILL_QUERY_CHARS = 500
const MAX_ANTV_SKILL_CONTENT_CHARS = 2_400
const MAX_ANTV_SKILL_CONTEXT_CHARS = 16_000

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
  const antvSkillContext = getAntvChartSkillContext(answer)

  return [
    "You are responsible for turning Notebook answer content into one visualization opportunity.",
    "Use the AntV chart visualization skills retrieved from @antv/chart-visualization-skills.",
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
    "- Write a concise title that summarizes the chart's core message, not a generic chart type.",
    "- For bar, column, and pie data, use category + value.",
    "- For line data, use time + value.",
    "- Preserve negative values for bar, column, and line charts when the answer explicitly contains them.",
    "- Use pie only for positive part-to-whole values; do not use pie for negative or mixed-sign data.",
    "- Select only one chart: the one with the highest information value.",
    "- Output JSON only, with no explanations and no Markdown.",
    "",
    "AntV chart visualization skill context:",
    antvSkillContext,
    "",
    "Answer content:",
    answer,
  ].join("\n")
}

export function getAntvChartSkillContext(answer: string): string {
  try {
    const skills = retrieve(buildAntvSkillQuery(answer), {
      library: ANTV_CHART_LIBRARY,
      topK: ANTV_CHART_SKILL_TOP_K,
      content: true,
    })
    const context = formatAntvChartSkills(skills)
    return context.length > 0
      ? context.slice(0, MAX_ANTV_SKILL_CONTEXT_CHARS)
      : "No AntV chart visualization skill content was returned."
  } catch (error) {
    logger.warn("chat-diagram: AntV skill retrieval failed", {
      error: summarizeUnknownError(error),
    })
    return [
      "AntV chart visualization skill retrieval failed.",
      "Continue with the explicit chart-selection and no-fabrication rules above.",
    ].join("\n")
  }
}

function buildAntvSkillQuery(answer: string): string {
  const normalizedAnswer = answer.replace(/\s+/gu, " ").trim()
  return [
    "g2 chart visualization bar column line pie comparison trend part-to-whole",
    normalizedAnswer.slice(0, MAX_ANTV_SKILL_QUERY_CHARS),
  ]
    .filter((part): part is string => part.length > 0)
    .join(" ")
}

function formatAntvChartSkills(skills: readonly Skill[]): string {
  return skills
    .map((skill): string => {
      const content = skill.content?.trim()
      const summary = [
        `Skill: ${skill.id}`,
        skill.title ? `Title: ${skill.title}` : null,
        skill.description ? `Description: ${skill.description}` : null,
        content
          ? `Content:\n${content.slice(0, MAX_ANTV_SKILL_CONTENT_CHARS)}`
          : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
      return summary
    })
    .filter((entry): boolean => entry.length > 0)
    .join("\n\n---\n\n")
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

  if (spec.type === "pie" && data.some((datum): boolean => datum.value <= 0)) {
    return {
      type: "none",
      reason:
        "The answer did not contain positive part-to-whole data for a pie chart.",
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
