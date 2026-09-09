import "server-only"

import { generateObject } from "ai"

import { buildDistillPrompt } from "./distill-prompts"
import {
  entityDistillOutputSchema,
  experienceDistillOutputSchema,
  indicatorDistillOutputSchema,
  toMemoryOperations,
  type DistillObservationInput,
  type DistillPassKind,
  type ExistingMemoryContextItem,
  type MemoryOperations,
} from "./distill-types"
import { CHAT_MODEL } from "@/lib/ai"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

const MEMORY_EXTRACTION_MODEL = process.env.MEMORY_EXTRACTION_MODEL ?? CHAT_MODEL

/**
 * One structured-output call for a single distill pass.
 * Best-effort — distill runs as a background job; a model failure returns
 * null so the workflow can skip applying that pass (logged). No multi-level
 * fallback chain.
 *
 * Input: pending observation batch + existing memories of kinds this pass may
 * write + allowed document ids for the batch.
 * Output: full MemoryOperations with only this pass's arrays populated
 * (others empty), ready for resolveMemoryOperations.
 */
export async function distillMemoryPass(input: {
  readonly pass: DistillPassKind
  readonly workspaceId: string
  readonly observations: readonly DistillObservationInput[]
  readonly existingItems: readonly ExistingMemoryContextItem[]
  readonly referencedDocumentIds: readonly string[]
}): Promise<MemoryOperations | null> {
  const prompt = buildDistillPrompt(input.pass, {
    observations: input.observations,
    existingItems: input.existingItems,
    referencedDocumentIds: input.referencedDocumentIds,
  })

  try {
    switch (input.pass) {
      case "indicator": {
        const response = await generateObject({
          model: MEMORY_EXTRACTION_MODEL,
          schema: indicatorDistillOutputSchema,
          messages: [{ role: "user", content: prompt }],
        })
        return toMemoryOperations("indicator", response.object)
      }
      case "experience": {
        const response = await generateObject({
          model: MEMORY_EXTRACTION_MODEL,
          schema: experienceDistillOutputSchema,
          messages: [{ role: "user", content: prompt }],
        })
        return toMemoryOperations("experience", response.object)
      }
      case "entity": {
        const response = await generateObject({
          model: MEMORY_EXTRACTION_MODEL,
          schema: entityDistillOutputSchema,
          messages: [{ role: "user", content: prompt }],
        })
        return toMemoryOperations("entity", response.object)
      }
    }
  } catch (error) {
    logger.warn("memory: distill model call failed; skipping pass", {
      workspaceId: input.workspaceId,
      pass: input.pass,
      model: MEMORY_EXTRACTION_MODEL,
      observationCount: input.observations.length,
      error: summarizeUnknownError(error),
    })
    return null
  }
}
