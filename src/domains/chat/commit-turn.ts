import { Either } from "effect"

import type { MemoryCitation } from "@/agent-harness"
import { generateAgenticOutputManifest } from "./prompt"
import { triggerMemoryExtraction } from "@/domains/memory/extract-trigger"
import { retrievalActivationService } from "@/domains/retrieval-activation/service"
import { toChunkUnitRef } from "@/domains/retrieval-activation/types"
import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import type { ChatCitationView } from "./types"
import {
  handleChatTurn,
  type ChatTurnError,
  type ChatTurnValue,
} from "./service"

type CommitChatTurnInput = Parameters<typeof handleChatTurn>[0]

/**
 * Production chat-turn commit used by the HTTP route and the 观心 batch
 * script: answer → persist → extract fluid memory → record cited
 * crystal/memory activations.
 */
export async function commitChatTurn(
  input: CommitChatTurnInput,
): Promise<Either.Either<ChatTurnValue, ChatTurnError>> {
  let memoryCitations: readonly MemoryCitation[] = []
  const result = await handleChatTurn({
    ...input,
    generateAnswer: async (generateInput) => {
      const generated = await input.generateAnswer({
        ...generateInput,
      })
      memoryCitations = generated.manifest.memoryCitations
      return generated
    },
  })

  if (Either.isRight(result)) {
    void triggerMemoryExtraction({
      workspaceId: input.workspace.id,
      threadId: result.right.threadId,
      userMessageId: result.right.messages[0].id,
      assistantMessageId: result.right.messages[1].id,
    })
    void recordChunkActivations({
      workspaceId: input.workspace.id,
      citations: result.right.messages[1].citations,
    })
    void recordMemoryActivations({
      workspaceId: input.workspace.id,
      memoryCitations,
    })
  }

  return result
}

export async function commitAgenticChatTurn(
  input: Omit<CommitChatTurnInput, "generateAnswer">,
): Promise<Either.Either<ChatTurnValue, ChatTurnError>> {
  return commitChatTurn({
    ...input,
    generateAnswer: (generateInput) =>
      generateAgenticOutputManifest({
        ...generateInput,
        workspaceId: input.workspace.id,
      }),
  })
}

/**
 * Fire-and-forget activation ledger write for crystal chunks actually cited
 * in this turn's answer. Only citations with both a documentId and a
 * chunkId count — a citation missing either can't be identified down to a
 * chunk (see ChatCitationView / RetrievalResultView).
 */
export async function recordChunkActivations(input: {
  readonly workspaceId: string
  readonly citations: readonly ChatCitationView[] | undefined
}): Promise<void> {
  const activationInputs = (input.citations ?? []).flatMap((citation) => {
    const documentId = citation.source.documentId
    const chunkId = citation.chunkId
    if (!documentId || !chunkId) return []
    return [
      {
        workspaceId: input.workspaceId,
        unitType: "crystal_chunk" as const,
        unitRef: toChunkUnitRef({ documentId, chunkId }),
      },
    ]
  })
  if (activationInputs.length === 0) return

  try {
    await retrievalActivationService.recordActivations(activationInputs)
  } catch (error) {
    logger.warn("chat: failed to record chunk activations", {
      workspaceId: input.workspaceId,
      chunkCount: activationInputs.length,
      error: summarizeUnknownError(error),
    })
  }
}

/**
 * Fire-and-forget activation ledger write for fluid memory items actually
 * cited in this turn's finalize output.
 */
export async function recordMemoryActivations(input: {
  readonly workspaceId: string
  readonly memoryCitations: readonly MemoryCitation[]
}): Promise<void> {
  const activationInputs = input.memoryCitations.map((citation) => ({
    workspaceId: input.workspaceId,
    unitType: "fluid_memory" as const,
    unitRef: citation.itemId,
  }))
  if (activationInputs.length === 0) return

  try {
    await retrievalActivationService.recordActivations(activationInputs)
  } catch (error) {
    logger.warn("chat: failed to record memory activations", {
      workspaceId: input.workspaceId,
      memoryCount: activationInputs.length,
      error: summarizeUnknownError(error),
    })
  }
}
