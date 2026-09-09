/**
 * Coarse-capture prompt for the raw observation layer.
 *
 * Capture extracts durable USER points of concern only. It does not classify
 * into final memory kinds, does not dedup against existing items, and does not
 * emit create/merge/deprecate decisions — those belong to distill.
 */

/** Structural output shape only — no domain content. */
const CAPTURE_OUTPUT_SCHEMA_BLOCK = `{
  "observations": [{
    "signal": "string — one durable clue about what the USER cares about",
    "evidenceQuote": "string — short verbatim USER snippet supporting signal",
    "subjectHint": "string optional — topic anchor (metric name / company / topic)",
    "confidence": 0.0
  }]
}`

/**
 * Illustrative only — kept separate so the model does not treat these domain
 * phrases as required vocabulary.
 */
const ILLUSTRATIVE_EXAMPLES_BLOCK = `## Illustrative examples (finance vertical — not exhaustive, not required vocabulary)

These show shape and judgement only. Capture whatever the user actually said;
do not force the conversation into this domain.

- User names a recurring evaluation metric → one observation (signal + quote).
- User states a durable judgement frame (e.g. long-horizon) → one observation.
- User states a reusable when → then discipline → one observation.
- User says they actively track a named company → one observation.
- Skip: a one-off factual question about a page/number, small talk, or an
  assistant suggestion the user did not endorse.`

const MAIN_INSTRUCTIONS_BLOCK = `You capture RAW OBSERVATIONS for a user's fluid memory pipeline.

These are cheap, high-recall clues about what the USER cares about. A later
distill step will decide final kinds (indicator / rule / stance / entity) and
merge them. Do NOT classify observations into those kinds. Do NOT emit any
kind / type / category field. Do NOT deduplicate. Do NOT invent
create/merge/deprecate operations.

Document facts live elsewhere (crystal memory). Never capture document facts,
retrieved numbers, or page content as observations.

## What to capture

From the USER turn only, emit zero or more observations when there is real
evidence of a durable, reusable point of concern:

- signal — one short clue in the user's language (what to remember later).
- evidenceQuote — a short verbatim snippet from the USER turn that supports it.
- subjectHint — optional short topic anchor (metric name, company, topic). Prefer omit when none.
- confidence — 1 only when the user stated it explicitly.

## Language

- Keep this instruction set and enum/field names in English.
- Write every free-text value (signal, evidenceQuote, subjectHint) in the same
  language the USER wrote in this turn. Do not translate the user's terms into
  English unless the user themselves used English.

## Judgement

- Capture only durable, reusable clues about what the USER cares about.
- Skip one-off questions, document facts, small talk, and assistant claims the
  user did not endorse.
- Prefer atomic clues: one observation per distinct clue. Do not merge unrelated
  ideas into one signal.
- Omit optional fields instead of setting them to null.
- If nothing is worth capturing, return {"observations": []}.`

export function buildCapturePrompt(input: {
  readonly userText: string
  readonly assistantText: string
  readonly referencedDocumentIds: readonly string[]
}): string {
  const documentsBlock =
    input.referencedDocumentIds.length === 0
      ? "(no documents referenced in this turn)"
      : input.referencedDocumentIds.join(", ")

  return `${MAIN_INSTRUCTIONS_BLOCK}

${ILLUSTRATIVE_EXAMPLES_BLOCK}

## Output JSON schema (follow exactly; do not invent fields)

${CAPTURE_OUTPUT_SCHEMA_BLOCK}

## REFERENCED DOCUMENT IDS

${documentsBlock}

## CONVERSATION TURN

[user]
${input.userText}

[assistant]
${input.assistantText}`
}
