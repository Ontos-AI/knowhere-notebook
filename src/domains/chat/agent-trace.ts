import type { HarnessTrace } from "@/agent-harness"

export const RECENT_CONTEXT_TURN_LIMIT = 5

export type ChatAgentTraceToolCall = {
  readonly tool: string
  readonly ok: boolean
  readonly summary: string
}

export type ChatAgentTrace = {
  readonly intentTask: string
  readonly toolCalls: readonly ChatAgentTraceToolCall[]
  readonly referencedDocumentIds: readonly string[]
}

export type RecentCaptureContextTurn = {
  readonly userText: string
  readonly assistantText?: string
  readonly agentTrace?: ChatAgentTrace
}

type RecentContextMessage = {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly agentTrace?: unknown
}

export function toChatAgentTrace(trace: HarnessTrace): ChatAgentTrace {
  return {
    intentTask: trace.intent?.task ?? "",
    toolCalls: trace.toolCalls.map((call) => ({
      tool: call.tool,
      ok: call.ok,
      summary: JSON.stringify({
        input: call.inputSummary,
        output: call.outputSummary,
      }),
    })),
    referencedDocumentIds: collectReferencedDocumentIds(trace),
  }
}

export function toRecentCaptureContext(
  messages: readonly RecentContextMessage[],
  currentMessageIds: readonly string[],
): RecentCaptureContextTurn[] {
  const exclude = new Set(currentMessageIds)
  const prior = messages.filter((message) => !exclude.has(message.id))
  const turns: RecentCaptureContextTurn[] = []

  for (let i = 0; i < prior.length; ) {
    const message = prior[i]
    if (!message || message.role !== "user") {
      i += 1
      continue
    }

    const next = prior[i + 1]
    if (next?.role === "assistant") {
      const agentTrace = readChatAgentTrace(next.agentTrace)
      turns.push({
        userText: message.content,
        assistantText: next.content,
        ...(agentTrace ? { agentTrace } : {}),
      })
      i += 2
      continue
    }

    turns.push({ userText: message.content })
    i += 1
  }

  return turns.slice(-RECENT_CONTEXT_TURN_LIMIT)
}

export function readChatAgentTrace(value: unknown): ChatAgentTrace | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.intentTask !== "string") return undefined
  if (!Array.isArray(value.toolCalls)) return undefined
  if (!Array.isArray(value.referencedDocumentIds)) return undefined

  const toolCalls: ChatAgentTraceToolCall[] = []
  for (const item of value.toolCalls) {
    if (!isRecord(item)) return undefined
    if (typeof item.tool !== "string") return undefined
    if (typeof item.ok !== "boolean") return undefined
    if (typeof item.summary !== "string") return undefined
    toolCalls.push({
      tool: item.tool,
      ok: item.ok,
      summary: item.summary,
    })
  }

  const referencedDocumentIds: string[] = []
  for (const id of value.referencedDocumentIds) {
    if (typeof id !== "string") return undefined
    referencedDocumentIds.push(id)
  }

  return {
    intentTask: value.intentTask,
    toolCalls,
    referencedDocumentIds,
  }
}

function collectReferencedDocumentIds(trace: HarnessTrace): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const chunk of trace.ledger.chunks) {
    const id = chunk.source.documentId
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
