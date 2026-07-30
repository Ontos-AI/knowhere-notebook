import { generateObject, NoObjectGeneratedError } from "ai"
import g2SkillIndex from "@antv/chart-visualization-skills/dist/index/g2.index.json"
import type { Skill } from "@antv/chart-visualization-skills"
import { z } from "zod"

import { getChatModel, getChatModelLabel, isChatConfigured } from "@/lib/ai"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

const MAX_ANSWER_CHARS = 12_000
const MAX_REASON_CHARS = 240
const ANTV_CHART_LIBRARY = "g2"
const ANTV_CHART_SKILL_TOP_K = 5
const MAX_ANTV_SKILL_QUERY_CHARS = 500
const MAX_ANTV_SKILL_CONTENT_CHARS = 2_400
const MAX_ANTV_SKILL_CONTEXT_CHARS = 16_000
const MAX_FAILED_OBJECT_OUTPUT_CHARS = 4_000
const DEFAULT_NO_DIAGRAM_REASON =
  "No clear chartable data was found. Ask for a table or numeric comparison first."
const ANTV_CHART_SEARCH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "chart",
  "charts",
  "visualization",
  "data",
  "value",
  "values",
  "answer",
  "content",
])

type AntvChartSkillInfo = {
  readonly name?: string
  readonly description?: string
  readonly constraintsContent?: string
}

type AntvChartSkillIndex = {
  readonly info?: AntvChartSkillInfo
  readonly skills: readonly Skill[]
}

type IndexedAntvChartSkill = {
  readonly skill: Skill
  readonly tokenWeights: ReadonlyMap<string, number>
}

const antvG2SkillIndex = g2SkillIndex as AntvChartSkillIndex
const indexedAntvG2Skills = buildAntvChartSkillSearchIndex(
  antvG2SkillIndex.skills,
)

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
  if (!isChatConfigured()) {
    throw new Error(
      "Chat is not configured. Set either AI_GATEWAY_API_KEY (Vercel AI " +
        "Gateway) or CHAT_BASE_URL + CHAT_MODEL + CHAT_API_KEY (OpenAI-compatible) " +
        "in .env.local.",
    )
  }

  const prompt = buildChatDiagramPrompt(input.answer)
  let failedOutput: string | undefined
  try {
    return await requestChatDiagramObject({
      attempt: "initial",
      prompt,
    })
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error
    }

    failedOutput = error.text
    logger.warn("chat-diagram: llm object generation failed", {
      attempt: "initial",
      detail: summarizeUnknownError(error),
      generatedTextLength: error.text?.length ?? 0,
    })
  }

  const repairPrompt = buildChatDiagramRepairPrompt({
    answer: input.answer,
    failedOutput,
  })

  try {
    return await requestChatDiagramObject({
      attempt: "repair",
      prompt: repairPrompt,
    })
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) {
      throw error
    }

    logger.warn("chat-diagram: llm object repair failed", {
      attempt: "repair",
      detail: summarizeUnknownError(error),
      generatedTextLength: error.text?.length ?? 0,
    })
    return {
      type: "none",
      reason: DEFAULT_NO_DIAGRAM_REASON,
    }
  }
}

async function requestChatDiagramObject(input: {
  readonly attempt: "initial" | "repair"
  readonly prompt: string
}): Promise<ChatDiagramSpec> {
  logger.info("chat-diagram: llm request", {
    attempt: input.attempt,
    model: getChatModelLabel(),
    promptCharLength: input.prompt.length,
  })
  const response = await generateObject({
    model: getChatModel(),
    schema: chatDiagramSpecSchema,
    prompt: input.prompt,
  })
  const spec = normalizeChatDiagramSpec(response.object)
  logger.info("chat-diagram: llm response", {
    attempt: input.attempt,
    model: getChatModelLabel(),
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

export function buildChatDiagramRepairPrompt(input: {
  readonly answer: string
  readonly failedOutput?: string
}): string {
  const failedOutput = input.failedOutput?.trim()

  return [
    "The previous diagram-generation output did not match the required schema.",
    "Return one valid JSON object only. Do not include Markdown, prose, code fences, comments, or extra keys.",
    "",
    "Allowed JSON shapes:",
    `{"type":"none","reason":"${DEFAULT_NO_DIAGRAM_REASON}"}`,
    '{"type":"column","source":"chart-visualization-skills","title":"Revenue by Segment","axisYTitle":"USD billions","data":[{"category":"Cloud","value":42},{"category":"Ads","value":28}]}',
    '{"type":"line","source":"chart-visualization-skills","title":"Revenue Trend","axisXTitle":"Period","axisYTitle":"USD billions","data":[{"time":"2024","value":10},{"time":"2025","value":14}]}',
    "",
    "Repair rules:",
    "- If the answer does not contain at least two explicit comparable numbers or time points, return the none object.",
    "- If making a chart would require inferred, fabricated, hidden, or unit-mixed values, return the none object.",
    '- For charts, source must be exactly "chart-visualization-skills".',
    "- For bar, column, and pie data, use category + value.",
    "- For line data, use time + value.",
    "- Use at most 12 data points.",
    "",
    "Answer content:",
    input.answer,
    failedOutput
      ? [
          "",
          "Previous invalid output:",
          failedOutput.slice(0, MAX_FAILED_OBJECT_OUTPUT_CHARS),
        ].join("\n")
      : "",
  ]
    .filter((part): boolean => part.length > 0)
    .join("\n")
}

export function getAntvChartSkillContext(answer: string): string {
  try {
    const skills = retrieveAntvChartSkills(
      buildAntvSkillQuery(answer),
      ANTV_CHART_SKILL_TOP_K,
    )
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

export function retrieveAntvChartSkills(
  query: string,
  topK: number = ANTV_CHART_SKILL_TOP_K,
): readonly Skill[] {
  const queryTokens = tokenizeAntvChartSearchText(query)
  const rankedSkills = indexedAntvG2Skills
    .map((indexedSkill) => ({
      skill: indexedSkill.skill,
      score: scoreAntvChartSkill(indexedSkill, queryTokens),
    }))
    .filter((rankedSkill): boolean => rankedSkill.score > 0)
    .sort((left, right): number => right.score - left.score)
    .slice(0, topK)
    .map((rankedSkill): Skill => rankedSkill.skill)

  const infoSkill = buildAntvChartInfoSkill(antvG2SkillIndex.info)
  return infoSkill ? [infoSkill, ...rankedSkills] : rankedSkills
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

function buildAntvChartSkillSearchIndex(
  skills: readonly Skill[],
): readonly IndexedAntvChartSkill[] {
  return skills.map((skill): IndexedAntvChartSkill => ({
    skill,
    tokenWeights: createAntvChartSkillTokenWeights(skill),
  }))
}

function createAntvChartSkillTokenWeights(
  skill: Skill,
): ReadonlyMap<string, number> {
  const tokenWeights = new Map<string, number>()
  addWeightedAntvChartTokens(tokenWeights, skill.id, 8)
  addWeightedAntvChartTokens(tokenWeights, skill.title ?? "", 8)
  addWeightedAntvChartTokens(tokenWeights, skill.tags.join(" "), 7)
  addWeightedAntvChartTokens(tokenWeights, skill.category, 5)
  addWeightedAntvChartTokens(tokenWeights, skill.subcategory, 5)
  addWeightedAntvChartTokens(tokenWeights, skill.description ?? "", 3)
  addWeightedAntvChartTokens(tokenWeights, skill.use_cases.join(" "), 2)
  addWeightedAntvChartTokens(
    tokenWeights,
    skill.content?.slice(0, 2_000) ?? "",
    1,
  )
  return tokenWeights
}

function addWeightedAntvChartTokens(
  tokenWeights: Map<string, number>,
  text: string,
  weight: number,
): void {
  for (const token of tokenizeAntvChartSearchText(text)) {
    tokenWeights.set(token, (tokenWeights.get(token) ?? 0) + weight)
  }
}

function tokenizeAntvChartSearchText(text: string): readonly string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu)
  return (matches ?? []).filter(
    (token): boolean =>
      token.length > 1 && !ANTV_CHART_SEARCH_STOP_WORDS.has(token),
  )
}

function scoreAntvChartSkill(
  indexedSkill: IndexedAntvChartSkill,
  queryTokens: readonly string[],
): number {
  return queryTokens.reduce((score, token): number => {
    return score + (indexedSkill.tokenWeights.get(token) ?? 0)
  }, 0)
}

function buildAntvChartInfoSkill(
  info: AntvChartSkillInfo | undefined,
): Skill | undefined {
  if (!info) {
    return undefined
  }

  return {
    id: `__info__${ANTV_CHART_LIBRARY}`,
    title: info.name ?? "AntV G2",
    description: info.description ?? "AntV G2 chart visualization constraints.",
    library: ANTV_CHART_LIBRARY,
    version: "",
    category: "__info__",
    subcategory: "",
    tags: [],
    difficulty: "",
    use_cases: [],
    anti_patterns: [],
    related: [],
    content: info.constraintsContent,
  }
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
