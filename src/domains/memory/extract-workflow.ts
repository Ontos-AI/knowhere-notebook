import "server-only"

import type { WorkflowContext } from "@upstash/workflow"

import { triggerMemoryDistill } from "./distill-trigger"
import { captureObservations } from "./extraction-model"
import { memoryService } from "./service"
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

/**
 * Per-turn coarse capture: load the turn → LLM observations → append-only
 * insert into fluid_observations. Never writes fluid_memory_items (distill
 * owns that). After persist, maybe-trigger distill when pending is high enough.
 */
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
    logger.warn("memory: capture skipped — turn messages not found", {
      workspaceId: payload.workspaceId,
      threadId: payload.threadId,
    })
    return
  }

  const observations = await context.run("capture", () =>
    captureObservations({
      workspaceId: payload.workspaceId,
      userText: turn.userText,
      assistantText: turn.assistantText,
      referencedDocumentIds: turn.referencedDocumentIds,
    }),
  )
  if (!observations) return

  const inserted = await context.run("persist-observations", async () => {
    if (observations.length === 0) return []
    return memoryService.insertObservations({
      workspaceId: payload.workspaceId,
      sourceMessageId: payload.assistantMessageId,
      referencedDocumentIds: turn.referencedDocumentIds,
      observations,
    })
  })

  await context.run("maybe-trigger-distill", async () => {
    await triggerMemoryDistill({ workspaceId: payload.workspaceId })
  })

  logger.info("memory: capture workflow finished", {
    workspaceId: payload.workspaceId,
    threadId: payload.threadId,
    assistantMessageId: payload.assistantMessageId,
    observationCount: inserted.length,
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
