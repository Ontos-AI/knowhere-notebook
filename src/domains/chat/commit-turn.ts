import { Either } from "effect"

import type { MemoryCitation } from "@/agent-harness"
import {
  captureMemoryTurn,
  recordActivations,
} from "@/integrations/memento/client"
import { generateAgenticOutputManifest } from "./prompt"
import type { ChatCitationView } from "./types"
import {
  handleChatTurn,
  type ChatTurnError,
  type ChatTurnValue,
} from "./service"

type CommitChatTurnInput = Parameters<typeof handleChatTurn>[0]

/**
 * Production chat-turn commit used by the HTTP route: answer → persist →
 * capture fluid memory on Memento → record cited crystal/memory activations.
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
    const [userMessage, assistantMessage] = result.right.messages
    void captureMemoryTurn({
      workspaceId: input.workspace.id,
      sessionId: result.right.threadId,
      turns: [
        {
          userText: userMessage.content,
          assistantText: assistantMessage.content,
          sourceMessageId: assistantMessage.id,
          referencedDocumentIds: collectCitationDocumentIds(
            assistantMessage.citations,
          ),
        },
      ],
    })
    void recordChunkActivations({
      workspaceId: input.workspace.id,
      citations: assistantMessage.citations,
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
  await recordActivations(activationInputs)
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
  await recordActivations(activationInputs)
}

function toChunkUnitRef(input: {
  readonly documentId: string
  readonly chunkId: string
}): string {
  return `${input.documentId}:${input.chunkId}`
}

function collectCitationDocumentIds(
  citations: readonly ChatCitationView[] | undefined,
): string[] {
  const ids = new Set<string>()
  for (const citation of citations ?? []) {
    const documentId = citation.source.documentId
    if (typeof documentId === "string" && documentId.length > 0) {
      ids.add(documentId)
    }
  }
  return [...ids]
}
