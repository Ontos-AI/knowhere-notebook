import "server-only"

import type { WorkflowContext } from "@upstash/workflow"

import { extractMemoryOperations } from "./extraction-model"
import {
  summarizePayloadForContext,
  type ExistingMemoryContextItem,
} from "./prompts"
import { resolveMemoryOperations } from "./resolve-operations"
import { tokenizeMemoryText } from "./search-index"
import { memoryService } from "./service"
import { fluidMemoryKinds, isFluidMemoryKind } from "./types"
import { chatThreadService } from "@/domains/chat/thread-service"
import { logger } from "@/lib/logger"

export type MemoryExtractPayload = {
  readonly workspaceId: string
  readonly threadId: string
  readonly userMessageId: string
  readonly assistantMessageId: string
}

type MemoryExtractWorkflowContext = Pick<
  WorkflowContext<MemoryExtractPayload>,
  "run"
>

/** Prompt-context item that also carries status/payload for resolution. */
type MemoryWorkflowItem = ExistingMemoryContextItem & {
  readonly status: string
  readonly payload: unknown
}

/** Per-kind cap on lexical neighbors fed into the merge-decision prompt. */
const DEDUP_CANDIDATES_PER_KIND = 8

export function normalizeMemoryExtractPayload(
  raw: unknown,
): MemoryExtractPayload | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const workspaceId = getNonEmptyString(record.workspaceId)
  const threadId = getNonEmptyString(record.threadId)
  const userMessageId = getNonEmptyString(record.userMessageId)
  const assistantMessageId = getNonEmptyString(record.assistantMessageId)
  if (!workspaceId || !threadId || !userMessageId || !assistantMessageId) {
    return null
  }
  return { workspaceId, threadId, userMessageId, assistantMessageId }
}

export async function runMemoryExtractWorkflow(input: {
  readonly context: MemoryExtractWorkflowContext
  readonly payload: MemoryExtractPayload
}): Promise<void> {
  const { context, payload } = input

  const turn = await context.run("load-turn", async () => {
    const messages = await chatThreadService.listMessages(
      payload.workspaceId,
      payload.threadId,
    )
    const userMessage = messages?.find(
      (message) => message.id === payload.userMessageId,
    )
    const assistantMessage = messages?.find(
      (message) => message.id === payload.assistantMessageId,
    )
    if (!userMessage || !assistantMessage) return null
    return {
      userText: userMessage.content,
      assistantText: assistantMessage.content,
      referencedDocumentIds: collectCitationDocumentIds(
        assistantMessage.citations,
      ),
    }
  })
  if (!turn) {
    logger.warn("memory: extract skipped — turn messages not found", {
      workspaceId: payload.workspaceId,
      threadId: payload.threadId,
    })
    return
  }

  const existingItems = await context.run("retrieve-candidates", async () => {
    const queryTokens = tokenizeMemoryText(turn.userText).map(
      (entry) => entry.token,
    )
    if (queryTokens.length === 0) return []

    const byId = new Map<string, MemoryWorkflowItem>()
    for (const kind of fluidMemoryKinds) {
      const items = await memoryService.findDedupCandidates(
        payload.workspaceId,
        kind,
        queryTokens,
        DEDUP_CANDIDATES_PER_KIND,
      )
      for (const item of items) {
        if (!isFluidMemoryKind(item.kind) || byId.has(item.id)) continue
        byId.set(item.id, {
          id: item.id,
          kind: item.kind,
          status: item.status,
          payload: item.payload,
          abstractL0: item.abstractL0,
          payloadSummary: summarizePayloadForContext(item.kind, item.payload),
        })
      }
    }
    return [...byId.values()]
  })

  const operations = await context.run("extract-operations", () =>
    extractMemoryOperations({
      workspaceId: payload.workspaceId,
      userText: turn.userText,
      assistantText: turn.assistantText,
      referencedDocumentIds: turn.referencedDocumentIds,
      existingItems,
    }),
  )
  if (!operations) return

  const applied = await context.run("apply-operations", async () => {
    const resolved = resolveMemoryOperations({
      operations,
      existingItems,
      referencedDocumentIds: turn.referencedDocumentIds,
    })
    if (resolved.length === 0) return null
    return memoryService.applyOperations(
      payload.workspaceId,
      payload.assistantMessageId,
      resolved,
    )
  })

  logger.info("memory: extract workflow finished", {
    workspaceId: payload.workspaceId,
    threadId: payload.threadId,
    assistantMessageId: payload.assistantMessageId,
    candidateCount: existingItems.length,
    appliedOperations: applied?.map((operation) => operation.op) ?? [],
  })
}

function collectCitationDocumentIds(citations: unknown): string[] {
  if (!Array.isArray(citations)) return []
  const ids = new Set<string>()
  for (const citation of citations) {
    if (!citation || typeof citation !== "object") continue
    const source = (citation as Record<string, unknown>).source
    if (!source || typeof source !== "object") continue
    const documentId = (source as Record<string, unknown>).documentId
    if (typeof documentId === "string" && documentId.length > 0) {
      ids.add(documentId)
    }
  }
  return [...ids]
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null
}
