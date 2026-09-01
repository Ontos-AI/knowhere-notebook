import { z } from "zod"

import {
  decisionRulePayloadSchema,
  entityOfInterestPayloadSchema,
  indicatorPreferencePayloadSchema,
  stancePayloadSchema,
  type FluidMemoryKind,
} from "./types"

/**
 * LLM contract for fluid-memory extraction.
 *
 * Design borrowed from OpenViking's session-commit extraction (schema-driven
 * typed operations, prefetch-then-decide), reimplemented as a single
 * structured-output call: the model sees the turn plus lexically retrieved
 * dedup candidates and directly outputs per-kind operations
 * (create / skip / merge / deprecate), mirroring OpenViking's generated
 * operations model without its ReAct tool loop.
 */

const decisionSchema = z.object({
  op: z.enum(["create", "skip", "merge", "deprecate"]),
  targetItemId: z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .string()
      .optional()
      .describe(
        "Required for merge/deprecate: the id of the existing memory item this operation targets. Omit for create/skip.",
      ),
  ),
  reason: z.preprocess(
    (value) => (value === null ? undefined : value),
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
    .describe("How explicitly the user stated this (1 = explicit)."),
  decision: decisionSchema,
}

const stanceEntrySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  // Models sometimes emit "name" for a stance; the contract field is "statement".
  if (
    (typeof record.statement !== "string" || record.statement.length === 0) &&
    typeof record.name === "string" &&
    record.name.length > 0
  ) {
    const { name, ...rest } = record
    return { ...rest, statement: name }
  }
  return value
}, stancePayloadSchema.extend(memorySidecarFields))

const entityEntrySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  // Keep provenance reason required; if the model omitted it, fall back to L0.
  if (
    (typeof record.reason !== "string" || record.reason.length === 0) &&
    typeof record.abstractL0 === "string" &&
    record.abstractL0.length > 0
  ) {
    return { ...record, reason: record.abstractL0 }
  }
  return value
}, entityOfInterestPayloadSchema.extend(memorySidecarFields))

export const memoryOperationsSchema = z.object({
  indicatorPrefs: z
    .array(indicatorPreferencePayloadSchema.extend(memorySidecarFields))
    .default([]),
  stances: z.array(stanceEntrySchema).default([]),
  decisionRules: z
    .array(decisionRulePayloadSchema.extend(memorySidecarFields))
    .default([]),
  entities: z.array(entityEntrySchema).default([]),
})

export type MemoryOperations = z.infer<typeof memoryOperationsSchema>

export type ExistingMemoryContextItem = {
  readonly id: string
  readonly kind: FluidMemoryKind
  readonly abstractL0: string
  readonly payloadSummary: string
}

/** Structural output shape only — no domain content. */
const OUTPUT_SCHEMA_BLOCK = `{
  "indicatorPrefs": [{
    "name": "string",
    "aliases": ["string"],
    "definition": "string",
    "polarity": "higher_better|lower_better|context",
    "importance": "core|secondary",
    "formulaHint": "string (optional — omit if none)",
    "abstractL0": "string",
    "overviewL1": "string",
    "confidence": 0.0,
    "decision": { "op": "create|skip|merge|deprecate", "targetItemId": "id for merge/deprecate only", "reason": "string optional" }
  }],
  "stances": [{
    "statement": "string (the stance text; do not use a name field)",
    "scope": "string",
    "rationale": "string",
    "abstractL0": "string",
    "overviewL1": "string",
    "confidence": 0.0,
    "decision": { "op": "create|skip|merge|deprecate", "targetItemId": "id for merge/deprecate only", "reason": "string optional" }
  }],
  "decisionRules": [{
    "when": "string",
    "then": "string",
    "priority": "high|medium|low",
    "rationale": "string",
    "abstractL0": "string",
    "overviewL1": "string",
    "confidence": 0.0,
    "decision": { "op": "create|skip|merge|deprecate", "targetItemId": "id for merge/deprecate only", "reason": "string optional" }
  }],
  "entities": [{
    "name": "string",
    "ticker": "string optional",
    "aliases": ["string"],
    "knowhereDocumentIds": ["only ids listed under REFERENCED DOCUMENT IDS"],
    "reason": "string",
    "abstractL0": "string",
    "overviewL1": "string",
    "confidence": 0.0,
    "decision": { "op": "create|skip|merge|deprecate", "targetItemId": "id for merge/deprecate only", "reason": "string optional" }
  }]
}`

/**
 * Illustrative only — kept separate from the main instructions so the model
 * does not treat these domain phrases as required vocabulary.
 * Finance is the first vertical; add other industry blocks here later if needed.
 */
const ILLUSTRATIVE_EXAMPLES_BLOCK = `## Illustrative examples (finance vertical — not exhaustive, not required vocabulary)

These show shape and judgement only. Extract whatever the user actually said;
do not force the conversation into this domain or these metric names.

- indicatorPref: user says a named metric they repeatedly use to judge quality
  (shape: name + short definition + polarity + importance). Same idea applies
  outside finance (any recurring evaluation metric).
- stance: user states a durable judgement frame that changes how evidence is
  weighted (e.g. long-horizon vs short-horizon).
- decisionRule: user states a reusable when → then discipline over their metrics.
- entity: user says they actively track a named company/issuer and why.
- skip: a one-off factual question about a page/number in a document, small talk,
  or an assistant suggestion the user did not endorse.`

/** Domain-agnostic extraction instructions. */
const MAIN_INSTRUCTIONS_BLOCK = `You maintain a user's FLUID MEMORY: durable insights about how this user thinks, extracted from their conversation with an AI analyst.

Document facts live elsewhere (crystal memory). Never extract document facts, retrieved numbers, or page content as fluid memory.

## What to extract

Extract ONLY these four kinds, and ONLY when the turn gives real evidence from the USER:

- indicatorPrefs — recurring metrics or criteria the user uses to evaluate things.
  Fields: name, aliases, definition, polarity (higher_better | lower_better | context),
  importance (core | secondary), optional formulaHint.
- stances — durable positions that shape how the user weighs evidence.
  Fields: statement (required; do not invent a "name" field), scope, rationale.
- decisionRules — reusable when → then disciplines the user stated or clearly endorsed.
  Fields: when, then, priority (high | medium | low), rationale.
- entities — named subjects the user is actively tracking.
  Fields: name, optional ticker, aliases, reason (required), knowhereDocumentIds
  (only from REFERENCED DOCUMENT IDS below; never invent ids).

## Language

- Keep this instruction set and enum/field names in English.
- Write every free-text value (name, definition, statement, when/then, reason,
  abstractL0, overviewL1, aliases the user used, etc.) in the same language the
  USER wrote in this turn. Do not translate the user's terms into English unless
  the user themselves used English.

## Decision rules

- Extract only durable, reusable insights about the USER.
- Skip one-off questions, document facts, small talk, and assistant claims the user did not endorse.
- For every candidate, choose exactly one op against EXISTING MEMORIES:
  - create — genuinely new
  - skip — already covered, or too weak/ephemeral
  - merge — same insight refined; emit the full merged fields and set targetItemId
  - deprecate — user explicitly reversed a stored item; set targetItemId
- Be conservative: prefer create over merge when overlap is only partial; deprecate only on clear contradiction.
- Prefer one record per insight. If a preference already encodes how a metric should be read, do not also invent a near-duplicate decisionRule unless the user stated an explicit when → then action.
- abstractL0: one line. overviewL1: 2–3 sentences. confidence=1 only when the user stated it explicitly.
- Omit optional fields instead of setting them to null.
- If nothing is worth remembering, return all four arrays empty.`

export function buildMemoryExtractionPrompt(input: {
  readonly userText: string
  readonly assistantText: string
  readonly referencedDocumentIds: readonly string[]
  readonly existingItems: readonly ExistingMemoryContextItem[]
}): string {
  const existingBlock =
    input.existingItems.length === 0
      ? "(no existing memories yet)"
      : input.existingItems
          .map(
            (item) =>
              `- [${item.kind}] id=${item.id} :: ${item.abstractL0} :: ${item.payloadSummary}`,
          )
          .join("\n")

  const documentsBlock =
    input.referencedDocumentIds.length === 0
      ? "(no documents referenced in this turn)"
      : input.referencedDocumentIds.join(", ")

  return `${MAIN_INSTRUCTIONS_BLOCK}

${ILLUSTRATIVE_EXAMPLES_BLOCK}

## Output JSON schema (follow exactly; do not invent fields)

${OUTPUT_SCHEMA_BLOCK}

## EXISTING MEMORIES

${existingBlock}

## REFERENCED DOCUMENT IDS

${documentsBlock}

## CONVERSATION TURN

[user]
${input.userText}

[assistant]
${input.assistantText}`
}

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
