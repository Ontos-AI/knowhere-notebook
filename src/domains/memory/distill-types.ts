import { z } from "zod"

import {
  decisionRulePayloadSchema,
  entityOfInterestPayloadSchema,
  indicatorPreferencePayloadSchema,
  stancePayloadSchema,
  type FluidMemoryKind,
} from "./types"

/**
 * Distill-pass LLM contracts.
 *
 * Three separate structured-output schemas (indicator / experience /
 * entity). Capture never emits these shapes — distill is the only writer
 * of create/merge/deprecate decisions over `fluid_memory_items`.
 */

function nullToUndefined(value: unknown): unknown {
  return value === null ? undefined : value
}

const decisionSchema = z.object({
  op: z.enum(["create", "skip", "merge", "deprecate"]),
  targetItemId: z.preprocess(
    nullToUndefined,
    z
      .string()
      .optional()
      .describe(
        "Required for merge/deprecate: id of the existing memory item. Omit for create/skip.",
      ),
  ),
  reason: z.preprocess(
    nullToUndefined,
    z
      .string()
      .optional()
      .describe("Short justification, especially for skip/merge/deprecate."),
  ),
})

const memorySidecarFields = {
  abstractL0: z
    .string()
    .min(1)
    .describe("One line, <= 30 words: the essence of this insight."),
  overviewL1: z
    .string()
    .min(1)
    .describe("2-3 sentences: what it means and when it applies."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How explicitly the user stated this across the batch (1 = explicit)."),
  decision: decisionSchema,
}

const stanceEntrySchema = stancePayloadSchema.extend(memorySidecarFields)

const entityEntrySchema =
  entityOfInterestPayloadSchema.extend(memorySidecarFields)

const indicatorEntrySchema =
  indicatorPreferencePayloadSchema.extend(memorySidecarFields)

const decisionRuleEntrySchema =
  decisionRulePayloadSchema.extend(memorySidecarFields)

/** Full four-array shape consumed by resolveMemoryOperations. */
export const memoryOperationsSchema = z.object({
  indicatorPrefs: z.array(indicatorEntrySchema).default([]),
  stances: z.array(stanceEntrySchema).default([]),
  decisionRules: z.array(decisionRuleEntrySchema).default([]),
  entities: z.array(entityEntrySchema).default([]),
})

export type MemoryOperations = z.infer<typeof memoryOperationsSchema>

/** Pass 1 — indicator preferences only. */
export const indicatorDistillOutputSchema = z.object({
  indicatorPrefs: z.array(indicatorEntrySchema).default([]),
})

/** Pass 2 — stances + decision rules. */
export const experienceDistillOutputSchema = z.object({
  stances: z.array(stanceEntrySchema).default([]),
  decisionRules: z.array(decisionRuleEntrySchema).default([]),
})

/** Pass 3 — entities of interest only. */
export const entityDistillOutputSchema = z.object({
  entities: z.array(entityEntrySchema).default([]),
})

export type IndicatorDistillOutput = z.infer<typeof indicatorDistillOutputSchema>
export type ExperienceDistillOutput = z.infer<
  typeof experienceDistillOutputSchema
>
export type EntityDistillOutput = z.infer<typeof entityDistillOutputSchema>

export const distillPassKinds = [
  "indicator",
  "experience",
  "entity",
] as const

export type DistillPassKind = (typeof distillPassKinds)[number]

/** Pending observation row shape fed into distill prompts (batch evidence). */
export type DistillObservationInput = {
  readonly id: string
  readonly signal: string
  readonly evidenceQuote: string
  readonly subjectHint: string | null
  readonly confidence: number
  readonly referencedDocumentIds: readonly string[]
}

export type ExistingMemoryContextItem = {
  readonly id: string
  readonly kind: FluidMemoryKind
  readonly abstractL0: string
  readonly payloadSummary: string
}

/** Expand a single-pass LLM object into the full MemoryOperations record. */
export function toMemoryOperations(
  pass: DistillPassKind,
  output:
    | IndicatorDistillOutput
    | ExperienceDistillOutput
    | EntityDistillOutput,
): MemoryOperations {
  switch (pass) {
    case "indicator": {
      const typed = output as IndicatorDistillOutput
      return {
        indicatorPrefs: typed.indicatorPrefs,
        stances: [],
        decisionRules: [],
        entities: [],
      }
    }
    case "experience": {
      const typed = output as ExperienceDistillOutput
      return {
        indicatorPrefs: [],
        stances: typed.stances,
        decisionRules: typed.decisionRules,
        entities: [],
      }
    }
    case "entity": {
      const typed = output as EntityDistillOutput
      return {
        indicatorPrefs: [],
        stances: [],
        decisionRules: [],
        entities: typed.entities,
      }
    }
  }
}

/** Compact payload label for existing-item context in distill prompts. */
export function summarizePayloadForContext(
  kind: FluidMemoryKind,
  payload: unknown,
): string {
  if (!payload || typeof payload !== "object") return ""
  const record = payload as Record<string, unknown>
  switch (kind) {
    case "indicator_pref":
      return [record.name, record.definition]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(" — ")
    case "stance":
      return typeof record.statement === "string" ? record.statement : ""
    case "decision_rule":
      return [record.when, record.then]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(" => ")
    case "entity_of_interest":
      return [record.name, record.ticker]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(" ")
  }
}
