import "server-only"

import { generateObject } from "ai"

import {
  captureOutputSchema,
  type CaptureOutput,
  type CapturedObservation,
} from "./observation-types"
import { buildCapturePrompt } from "./prompts"
import { CHAT_MODEL } from "@/lib/ai"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

const MEMORY_EXTRACTION_MODEL = process.env.MEMORY_EXTRACTION_MODEL ?? CHAT_MODEL

/**
 * One structured-output call: conversation turn in, raw observations out.
 * Best-effort — this runs as a background job, so a model failure skips the
 * turn (logged) instead of degrading through fallbacks; the clue typically
 * resurfaces in a later turn.
 */
export async function captureObservations(input: {
  readonly workspaceId: string
  readonly userText: string
  readonly assistantText: string
  readonly referencedDocumentIds: readonly string[]
}): Promise<readonly CapturedObservation[] | null> {
  try {
    const response = await generateObject({
      model: MEMORY_EXTRACTION_MODEL,
      schema: captureOutputSchema,
      messages: [
        {
          role: "user",
          content: buildCapturePrompt(input),
        },
      ],
    })
    const output: CaptureOutput = response.object
    return output.observations
  } catch (error) {
    logger.warn("memory: capture model call failed; skipping turn", {
      workspaceId: input.workspaceId,
      model: MEMORY_EXTRACTION_MODEL,
      error: summarizeUnknownError(error),
    })
    return null
  }
}
