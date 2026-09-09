import { z } from "zod"

/**
 * Coarse-capture contract for the raw observation layer.
 *
 * Capture records durable USER clues (what the user cares about) only.
 * It does not classify into final memory kinds, does not dedup, and never
 * writes `fluid_memory_items`. `subjectHint` is an optional topic anchor
 * for later clustering — distill owns authoritative typing and merge.
 */

/** Single concentrated null→undefined coerce for optional capture fields. */
function nullToUndefined(value: unknown): unknown {
  return value === null ? undefined : value
}

export const capturedObservationSchema = z.object({
  signal: z
    .string()
    .min(1)
    .describe(
      "One durable clue about what the USER cares about, in the user's language.",
    ),
  evidenceQuote: z
    .string()
    .min(1)
    .describe("Short verbatim snippet from the USER turn that supports signal."),
  subjectHint: z.preprocess(
    nullToUndefined,
    z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional short topic anchor (metric name, company, topic). Prefer omit when none.",
      ),
  ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How explicitly the user stated this (1 = explicit)."),
})

export const captureOutputSchema = z.object({
  observations: z.array(capturedObservationSchema).default([]),
})

export type CapturedObservation = z.infer<typeof capturedObservationSchema>
export type CaptureOutput = z.infer<typeof captureOutputSchema>
