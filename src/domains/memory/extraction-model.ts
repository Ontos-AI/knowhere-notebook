import "server-only"

import { generateObject } from "ai"

import {
  buildMemoryExtractionPrompt,
  memoryOperationsSchema,
  type ExistingMemoryContextItem,
  type MemoryOperations,
} from "./prompts"
import { CHAT_MODEL } from "@/lib/ai"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"

const MEMORY_EXTRACTION_MODEL = process.env.MEMORY_EXTRACTION_MODEL ?? CHAT_MODEL

/**
 * One structured-output call: turn + existing active memories in, typed
 * operations out. Best-effort by design — this runs as a background job,
 * so a model failure skips the turn (logged) instead of degrading through
 * fallbacks; the insight typically resurfaces in a later turn.
 */
export async function extractMemoryOperations(input: {
  readonly workspaceId: string
  readonly userText: string
  readonly assistantText: string
  readonly referencedDocumentIds: readonly string[]
  readonly existingItems: readonly ExistingMemoryContextItem[]
}): Promise<MemoryOperations | null> {
  try {
    const response = await generateObject({
      model: MEMORY_EXTRACTION_MODEL,
      schema: memoryOperationsSchema,
      messages: [
        {
          role: "user",
          content: buildMemoryExtractionPrompt(input),
        },
      ],
    })
    return response.object
  } catch (error) {
    logger.warn("memory: extraction model call failed; skipping turn", {
      workspaceId: input.workspaceId,
      model: MEMORY_EXTRACTION_MODEL,
      existingItemCount: input.existingItems.length,
      error: summarizeUnknownError(error),
    })
    return null
  }
}
