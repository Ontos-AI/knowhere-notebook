import { Either } from "effect"

import type {
  EvidenceAsset,
  EvidenceChunk,
  HarnessRunResult,
  MemoryCitation,
} from "@/agent-harness"
import {
  captureMemoryTurn,
  reportRetrieval,
  type MementoRetrievalUnit,
} from "@/integrations/memento/client"
import { readChatAgentTrace, toRecentCaptureContext } from "./agent-trace"
import { generateAgenticOutputManifest } from "./prompt"
import type { ChatCitationView } from "./types"
import {
  handleChatTurn,
  type ChatTurnError,
  type ChatTurnValue,
} from "./service"

type CommitChatTurnInput = Parameters<typeof handleChatTurn>[0]

/**
 * Production chat-turn commit: answer → persist → capture fluid memory
 * → report this turn's retrieved set and cited subset to Memento.
 */
export async function commitChatTurn(
  input: CommitChatTurnInput,
): Promise<Either.Either<ChatTurnValue, ChatTurnError>> {
  let memoryCitations: readonly MemoryCitation[] = []
  let citedChunkRefs: readonly { readonly ref: string }[] = []
  let retrievedChunks: readonly EvidenceChunk[] = []
  let retrievedAssets: readonly EvidenceAsset[] = []
  let retrievedMemoryItems: readonly { readonly itemId: string }[] = []
  let didRetrieve = false
  const result = await handleChatTurn({
    ...input,
    generateAnswer: async (generateInput) => {
      const generated = await input.generateAnswer({
        ...generateInput,
      })
      memoryCitations = generated.manifest.memoryCitations
      citedChunkRefs = generated.manifest.citations
      retrievedChunks = generated.trace.ledger.chunks
      retrievedAssets = generated.trace.ledger.assets
      retrievedMemoryItems = generated.memoryItems
      didRetrieve = turnHadRetrieval(generated)
      return generated
    },
  })

  if (Either.isRight(result)) {
    const [userMessage, assistantMessage] = result.right.messages
    const storedMessages =
      (await input.repository.listMessagesForThread(
        input.workspace.id,
        result.right.threadId,
      )) ?? []
    const currentTrace = readChatAgentTrace(
      storedMessages.find((message) => message.id === assistantMessage.id)
        ?.agentTrace,
    )
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
          ...(currentTrace ? { agentTrace: currentTrace } : {}),
          recentContext: toRecentCaptureContext(storedMessages, [
            userMessage.id,
            assistantMessage.id,
          ]),
        },
      ],
    })
    if (didRetrieve) {
      void reportRetrieval({
        workspaceId: input.workspace.id,
        retrieved: [
          ...toChunkUnits(retrievedChunks),
          ...toMemoryUnits(retrievedMemoryItems),
        ],
        cited: [
          ...toChunkUnits(
            resolveCitedChunks(citedChunkRefs, retrievedChunks, retrievedAssets),
          ),
          ...toMemoryUnits(memoryCitations),
        ],
      })
    }
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

function turnHadRetrieval(generated: HarnessRunResult): boolean {
  if (generated.trace.ledger.retrievalCount > 0) return true
  if (generated.trace.ledger.chunks.length > 0) return true
  if (generated.memoryItems.length > 0) return true
  return generated.trace.toolCalls.some(
    (call) => call.tool === "memory_search" || call.tool === "knowhere_search",
  )
}

function toChunkUnits(
  chunks: readonly EvidenceChunk[],
): MementoRetrievalUnit[] {
  return chunks.flatMap((chunk) => {
    const documentId = chunk.source.documentId
    const chunkId = chunk.chunkId
    if (!documentId || !chunkId) return []
    return [
      {
        unitType: "crystal_chunk" as const,
        unitRef: `${documentId}:${chunkId}`,
      },
    ]
  })
}

function resolveCitedChunks(
  citations: readonly { readonly ref: string }[],
  chunks: readonly EvidenceChunk[],
  assets: readonly EvidenceAsset[],
): EvidenceChunk[] {
  const chunksByRef = new Map(chunks.map((chunk) => [chunk.ref, chunk]))
  const assetsByRef = new Map(assets.map((asset) => [asset.ref, asset]))
  return citations.flatMap((citation) => {
    const direct = chunksByRef.get(citation.ref)
    if (direct) return [direct]
    const asset = assetsByRef.get(citation.ref)
    const fromAsset = asset ? chunksByRef.get(asset.chunkRef) : undefined
    return fromAsset ? [fromAsset] : []
  })
}

function toMemoryUnits(
  items: readonly { readonly itemId: string }[],
): MementoRetrievalUnit[] {
  return items.map((item) => ({
    unitType: "fluid_memory" as const,
    unitRef: item.itemId,
  }))
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
