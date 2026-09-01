import { z } from "zod"

/**
 * Fluid memory type contract.
 *
 * Four typed payload kinds, extracted from conversation turns. The DB
 * stores `payload` as jsonb; these schemas are the validation boundary on
 * both write (LLM output) and read (repository decode) paths.
 */

export const fluidMemoryKinds = [
  "indicator_pref",
  "stance",
  "decision_rule",
  "entity_of_interest",
] as const

export type FluidMemoryKind = (typeof fluidMemoryKinds)[number]

export const indicatorPreferencePayloadSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  definition: z.string().min(1),
  polarity: z.enum(["higher_better", "lower_better", "context"]),
  importance: z.enum(["core", "secondary"]),
  formulaHint: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
})

export const stancePayloadSchema = z.object({
  statement: z.string().min(1),
  scope: z.string().min(1),
  rationale: z.string().min(1),
})

export const decisionRulePayloadSchema = z.object({
  when: z.string().min(1),
  then: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]),
  rationale: z.string().min(1),
})

export const entityOfInterestPayloadSchema = z.object({
  name: z.string().min(1),
  ticker: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
  aliases: z.array(z.string()).default([]),
  knowhereDocumentIds: z.array(z.string()).default([]),
  reason: z.string().min(1),
})

export type IndicatorPreferencePayload = z.infer<
  typeof indicatorPreferencePayloadSchema
>
export type StancePayload = z.infer<typeof stancePayloadSchema>
export type DecisionRulePayload = z.infer<typeof decisionRulePayloadSchema>
export type EntityOfInterestPayload = z.infer<
  typeof entityOfInterestPayloadSchema
>

export type FluidMemoryPayload =
  | IndicatorPreferencePayload
  | StancePayload
  | DecisionRulePayload
  | EntityOfInterestPayload

const payloadSchemas: Record<FluidMemoryKind, z.ZodType<FluidMemoryPayload>> = {
  indicator_pref: indicatorPreferencePayloadSchema,
  stance: stancePayloadSchema,
  decision_rule: decisionRulePayloadSchema,
  entity_of_interest: entityOfInterestPayloadSchema,
}

export function isFluidMemoryKind(value: unknown): value is FluidMemoryKind {
  return (
    typeof value === "string" &&
    (fluidMemoryKinds as readonly string[]).includes(value)
  )
}

/** Decode a persisted jsonb payload; returns null when the row is malformed. */
export function parseFluidMemoryPayload(
  kind: FluidMemoryKind,
  value: unknown,
): FluidMemoryPayload | null {
  const result = payloadSchemas[kind].safeParse(value)
  return result.success ? result.data : null
}

/** One decided operation over the memory set; persisted into memory_diffs. */
export type MemoryDiffOperation = {
  readonly op: "create" | "skip" | "merge" | "deprecate"
  readonly kind: FluidMemoryKind
  readonly itemId?: string
  readonly summary: string
  readonly reason?: string
}
