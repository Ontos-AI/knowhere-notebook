import type {
  DistillObservationInput,
  DistillPassKind,
  ExistingMemoryContextItem,
} from "./distill-types"

/**
 * Distill prompts — three isolated passes over the same pending observation
 * batch. Each pass sees ALL observations (no kind routing) and only the
 * existing memories of kinds that pass may write.
 */

const INDICATOR_OUTPUT_SCHEMA_BLOCK = `{
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
  }]
}`

const EXPERIENCE_OUTPUT_SCHEMA_BLOCK = `{
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
  }]
}`

const ENTITY_OUTPUT_SCHEMA_BLOCK = `{
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

const INDICATOR_ILLUSTRATIVE_BLOCK = `## Illustrative examples (finance vertical — not exhaustive, not required vocabulary)

These show shape and judgement only. Distill whatever the observations support;
do not force the batch into this domain or these metric names.

- Recurring evaluation metric named across clues → one indicatorPref (stable name + definition + polarity + importance).
- Same metric restated with a nuance → merge into the existing item, do not create a second.
- Skip: a one-off number question, document fact, or weak single-mention with no reusable criterion.`

const EXPERIENCE_ILLUSTRATIVE_BLOCK = `## Illustrative examples (finance vertical — not exhaustive, not required vocabulary)

These show shape and judgement only. Distill whatever the observations support;
do not force the batch into this domain.

- Durable judgement frame (e.g. long-horizon) → one stance (statement + scope + rationale).
- Reusable when → then discipline over the user's criteria → one decisionRule.
- Abstract away one-off instances; keep a single intent per rule. Split unrelated intents.
- Skip: process narration, document facts, or a preference that is only a metric definition (indicators are another pass).`

const ENTITY_ILLUSTRATIVE_BLOCK = `## Illustrative examples (finance vertical — not exhaustive, not required vocabulary)

These show shape and judgement only. Distill whatever the observations support;
do not force the batch into this domain.

- User actively tracks a named company/issuer across clues → one entity (name + reason; optional ticker/aliases).
- Same subject restated → merge; attach knowhereDocumentIds only from REFERENCED DOCUMENT IDS.
- Skip: a company mentioned only as a one-off fact question, or names that are not subjects of ongoing interest.`

const INDICATOR_INSTRUCTIONS_BLOCK = `You DISTILL indicator preferences for a user's fluid memory.

You receive a BATCH of raw observations (cheap clues about what the USER cares
about) plus existing indicator memories. Produce durable indicator_pref items
only. A separate pass handles stances, decision rules, and entities — never emit
those kinds here.

Constraints:
- One stable topic/name per preference; merge overlapping or synonymous names.
- Capture "what the user repeatedly uses to evaluate", not one-off facts.
- Keep unrelated criteria as separate items; do not mix them into one payload.

## What to emit

indicatorPrefs — recurring metrics or criteria the user uses to evaluate things.
Fields: name, aliases, definition, polarity (higher_better | lower_better | context),
importance (core | secondary), optional formulaHint, abstractL0, overviewL1,
confidence, decision.

## Language

- Keep this instruction set and enum/field names in English.
- Write every free-text value in the same language the observations use. Do not
  translate the user's terms into English unless the observations themselves used English.

## Decision rules

- Distill only from the observation batch evidence about the USER.
- Skip document facts, retrieved numbers, and weak/ephemeral clues.
- For every candidate, choose exactly one op against EXISTING MEMORIES:
  - create — genuinely new indicator
  - skip — already covered, or too weak
  - merge — same indicator refined; emit the full merged fields and set targetItemId
  - deprecate — user clearly reversed a stored indicator; set targetItemId
- Be conservative: prefer create over merge when overlap is only partial; deprecate only on clear contradiction.
- abstractL0: one line. overviewL1: 2–3 sentences. confidence=1 only when explicitly stated.
- Omit optional fields instead of setting them to null.
- If nothing qualifies, return {"indicatorPrefs": []}.`

const EXPERIENCE_INSTRUCTIONS_BLOCK = `You DISTILL stances and decision rules (insights) for a user's fluid memory.

You receive a BATCH of raw observations plus existing stance/decision-rule
memories. Produce durable stances and decisionRules only. A separate pass
handles indicators and entities — never emit those kinds here.

Constraints:
- Generalizable, reusable insight — not a process log of one session.
- Atomic scope: one intent per decisionRule; split if when would mix goals.
- Abstract away specific one-off entities/ids from the situation framing when the
  rule itself is general; keep concrete names only when the insight requires them.
- Do not restate a bare metric definition as a decisionRule — that belongs to the indicator pass.

## What to emit

- stances — durable positions that shape how the user weighs evidence.
  Fields: statement (required; do not invent a "name" field), scope, rationale,
  abstractL0, overviewL1, confidence, decision.
- decisionRules — reusable when → then disciplines the user stated or clearly endorsed.
  Fields: when, then, priority (high | medium | low), rationale, abstractL0,
  overviewL1, confidence, decision.

## Language

- Keep this instruction set and enum/field names in English.
- Write every free-text value in the same language the observations use. Do not
  translate the user's terms into English unless the observations themselves used English.

## Decision rules

- Distill only from the observation batch evidence about the USER.
- Skip document facts, small talk, and weak/ephemeral clues.
- For every candidate, choose exactly one op against EXISTING MEMORIES:
  - create — genuinely new
  - skip — already covered, or too weak
  - merge — same insight refined; emit the full merged fields and set targetItemId
  - deprecate — user clearly reversed a stored item; set targetItemId
- Be conservative: prefer create over merge when overlap is only partial; deprecate only on clear contradiction.
- Prefer one record per insight. Do not invent a near-duplicate decisionRule for a stance that already encodes the same frame unless the user stated an explicit when → then action.
- abstractL0: one line. overviewL1: 2–3 sentences. confidence=1 only when explicitly stated.
- Omit optional fields instead of setting them to null.
- If nothing qualifies, return {"stances": [], "decisionRules": []}.`

const ENTITY_INSTRUCTIONS_BLOCK = `You DISTILL entities of interest for a user's fluid memory.

You receive a BATCH of raw observations plus existing entity memories. Produce
durable entity_of_interest items only. A separate pass handles indicators,
stances, and decision rules — never emit those kinds here.

Constraints:
- Stable card for a subject the USER actively tracks.
- Merge overlapping names/aliases into one item; keep unrelated subjects separate.
- Attach document provenance only from ids listed under REFERENCED DOCUMENT IDS.

## What to emit

entities — named subjects the user is actively tracking.
Fields: name, optional ticker, aliases, reason (required), knowhereDocumentIds
(only from REFERENCED DOCUMENT IDS below; never invent ids), abstractL0,
overviewL1, confidence, decision.

## Language

- Keep this instruction set and enum/field names in English.
- Write every free-text value in the same language the observations use. Do not
  translate the user's terms into English unless the observations themselves used English.

## Decision rules

- Distill only from the observation batch evidence about the USER.
- Skip one-off name drops, document facts, and weak/ephemeral mentions.
- For every candidate, choose exactly one op against EXISTING MEMORIES:
  - create — genuinely new tracked subject
  - skip — already covered, or too weak
  - merge — same subject refined; emit the full merged fields and set targetItemId
  - deprecate — user clearly stopped tracking / reversed; set targetItemId
- Be conservative: prefer create over merge when overlap is only partial; deprecate only on clear contradiction.
- abstractL0: one line. overviewL1: 2–3 sentences. confidence=1 only when explicitly stated.
- Omit optional fields instead of setting them to null.
- If nothing qualifies, return {"entities": []}.`

export type BuildDistillPromptInput = {
  readonly observations: readonly DistillObservationInput[]
  readonly existingItems: readonly ExistingMemoryContextItem[]
  readonly referencedDocumentIds: readonly string[]
}

export function buildDistillPrompt(
  pass: DistillPassKind,
  input: BuildDistillPromptInput,
): string {
  switch (pass) {
    case "indicator":
      return assemblePrompt({
        instructions: INDICATOR_INSTRUCTIONS_BLOCK,
        examples: INDICATOR_ILLUSTRATIVE_BLOCK,
        outputSchema: INDICATOR_OUTPUT_SCHEMA_BLOCK,
        input,
      })
    case "experience":
      return assemblePrompt({
        instructions: EXPERIENCE_INSTRUCTIONS_BLOCK,
        examples: EXPERIENCE_ILLUSTRATIVE_BLOCK,
        outputSchema: EXPERIENCE_OUTPUT_SCHEMA_BLOCK,
        input,
      })
    case "entity":
      return assemblePrompt({
        instructions: ENTITY_INSTRUCTIONS_BLOCK,
        examples: ENTITY_ILLUSTRATIVE_BLOCK,
        outputSchema: ENTITY_OUTPUT_SCHEMA_BLOCK,
        input,
      })
  }
}

function assemblePrompt(args: {
  readonly instructions: string
  readonly examples: string
  readonly outputSchema: string
  readonly input: BuildDistillPromptInput
}): string {
  const existingBlock =
    args.input.existingItems.length === 0
      ? "(no existing memories yet)"
      : args.input.existingItems
          .map(
            (item) =>
              `- [${item.kind}] id=${item.id} :: ${item.abstractL0} :: ${item.payloadSummary}`,
          )
          .join("\n")

  const documentsBlock =
    args.input.referencedDocumentIds.length === 0
      ? "(no documents referenced in this batch)"
      : args.input.referencedDocumentIds.join(", ")

  const observationsBlock =
    args.input.observations.length === 0
      ? "(no pending observations)"
      : args.input.observations
          .map((observation) => formatObservation(observation))
          .join("\n\n")

  return `${args.instructions}

${args.examples}

## Output JSON schema (follow exactly; do not invent fields)

${args.outputSchema}

## EXISTING MEMORIES

${existingBlock}

## REFERENCED DOCUMENT IDS

${documentsBlock}

## PENDING OBSERVATIONS

${observationsBlock}`
}

function formatObservation(observation: DistillObservationInput): string {
  const subject =
    observation.subjectHint && observation.subjectHint.length > 0
      ? observation.subjectHint
      : "(none)"
  const docs =
    observation.referencedDocumentIds.length === 0
      ? "(none)"
      : observation.referencedDocumentIds.join(", ")
  return `- id=${observation.id}
  signal: ${observation.signal}
  evidenceQuote: ${observation.evidenceQuote}
  subjectHint: ${subject}
  confidence: ${observation.confidence}
  referencedDocumentIds: ${docs}`
}
