import "server-only"

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Effect } from "effect"

import { summarizeUnknownError } from "@/lib/format-log-value"
import { logger } from "@/lib/logger"
import { readMementoConfig } from "./config"
import type {
  ChatAgentTrace,
  RecentCaptureContextTurn,
} from "@/domains/chat/agent-trace"

export type MementoCaptureTurn = {
  readonly userText: string
  readonly assistantText?: string
  readonly sourceMessageId?: string
  readonly referencedDocumentIds?: readonly string[]
  readonly agentTrace?: ChatAgentTrace
  readonly recentContext?: readonly RecentCaptureContextTurn[]
}

export type MementoCaptureInput = {
  readonly workspaceId: string
  readonly sessionId: string
  readonly turns: readonly MementoCaptureTurn[]
}

export type MementoRetrievalUnit = {
  readonly unitType: "fluid_memory" | "crystal_chunk"
  readonly unitRef: string
}

export type MementoActivation = {
  readonly unitRef: string
  readonly rankingFactor: number
}

export async function captureMemoryTurn(
  input: MementoCaptureInput,
): Promise<void> {
  try {
    await postJson("/turns/capture", input)
  } catch (error) {
    // TODO: Memento 未部署时发送会失败，先只记警告；部署并对上地址后应能发到。
    logger.warn("chat: failed to capture memory turn", {
      workspaceId: input.workspaceId,
      error: summarizeUnknownError(error),
    })
  }
}

export async function reportRetrieval(input: {
  readonly workspaceId: string
  readonly retrieved: readonly MementoRetrievalUnit[]
  readonly cited: readonly MementoRetrievalUnit[]
}): Promise<void> {
  try {
    await postJson("/activations", {
      workspaceId: input.workspaceId,
      retrieved: input.retrieved,
      cited: input.cited,
    })
  } catch (error) {
    logger.warn("chat: failed to report retrieval", {
      workspaceId: input.workspaceId,
      retrievedCount: input.retrieved.length,
      citedCount: input.cited.length,
      error: summarizeUnknownError(error),
    })
  }
}

export type MementoWorkspaceProfile = {
  readonly name?: string
  readonly occupation?: string
  readonly ageStage?: string
  readonly communicationHabit?: string
  readonly workHabit?: string
}

export type MementoAgentFeedbackLesson = {
  readonly itemId: string
  readonly text: string
  readonly reflection: string
}

export async function getWorkspaceProfile(
  workspaceId: string,
): Promise<MementoWorkspaceProfile | null> {
  try {
    const body = await getJson(
      `/profile?${new URLSearchParams({ workspaceId }).toString()}`,
    )
    return parseWorkspaceProfile(body)
  } catch (error) {
    logger.warn("chat: failed to load workspace profile", {
      workspaceId,
      error: summarizeUnknownError(error),
    })
    return null
  }
}

export async function searchRelevantAgentFeedback(input: {
  readonly workspaceId: string
  readonly query: string
}): Promise<readonly MementoAgentFeedbackLesson[]> {
  try {
    const query = new URLSearchParams({
      workspaceId: input.workspaceId,
      query: input.query,
    })
    const body = await getJson(`/agent-feedback/relevant?${query.toString()}`)
    return parseAgentFeedbackLessons(body)
  } catch (error) {
    logger.warn("chat: failed to load agent feedback lessons", {
      workspaceId: input.workspaceId,
      error: summarizeUnknownError(error),
    })
    return []
  }
}

function parseWorkspaceProfile(body: unknown): MementoWorkspaceProfile | null {
  if (typeof body !== "object" || body === null) return null
  const profile = Reflect.get(body, "profile")
  if (profile === null) return null
  if (typeof profile !== "object" || profile === null) return null
  const slots = ["name", "occupation", "ageStage", "communicationHabit", "workHabit"] as const
  const parsed: Record<string, string> = {}
  for (const slot of slots) {
    const value = Reflect.get(profile, slot)
    if (typeof value === "string" && value.length > 0) parsed[slot] = value
  }
  return Object.keys(parsed).length > 0 ? parsed : null
}

function parseAgentFeedbackLessons(
  body: unknown,
): readonly MementoAgentFeedbackLesson[] {
  if (typeof body !== "object" || body === null) return []
  const items = Reflect.get(body, "items")
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const itemId = Reflect.get(item, "itemId")
    const text = Reflect.get(item, "text")
    const payload = Reflect.get(item, "payload")
    if (typeof itemId !== "string" || itemId.length === 0) return []
    if (typeof text !== "string" || text.length === 0) return []
    if (typeof payload !== "object" || payload === null) return []
    const reflection = Reflect.get(payload, "reflection")
    if (typeof reflection !== "string" || reflection.length === 0) return []
    return [{ itemId, text, reflection }]
  })
}

export async function listActivations(input: {
  readonly workspaceId: string
  readonly unitType: MementoRetrievalUnit["unitType"]
  readonly unitRefs: readonly string[]
}): Promise<readonly MementoActivation[]> {
  if (input.unitRefs.length === 0) return []
  const query = new URLSearchParams({
    workspaceId: input.workspaceId,
    unitType: input.unitType,
    unitRefs: input.unitRefs.join(","),
  })
  const body = await getJson(`/activations?${query.toString()}`)
  return parseActivations(body)
}

function parseActivations(body: unknown): readonly MementoActivation[] {
  if (typeof body !== "object" || body === null) {
    throw new Error("memento /activations: invalid response")
  }
  const activations = Reflect.get(body, "activations")
  if (!Array.isArray(activations)) {
    throw new Error("memento /activations: invalid response")
  }
  return activations.flatMap((activation) => {
    if (typeof activation !== "object" || activation === null) return []
    const unitRef = Reflect.get(activation, "unitRef")
    const rankingFactor = Reflect.get(activation, "rankingFactor")
    if (typeof unitRef !== "string" || unitRef.length === 0) return []
    if (typeof rankingFactor !== "number" || !Number.isFinite(rankingFactor)) {
      return []
    }
    return [{ unitRef, rankingFactor }]
  })
}

async function getJson(path: string): Promise<unknown> {
  const { status, body } = await Effect.runPromise(
    Effect.gen(function* () {
      const { baseUrl, serviceKey } = readMementoConfig()
      const request = HttpClientRequest.get(`${baseUrl}${path}`).pipe(
        HttpClientRequest.setHeader(
          "Authorization",
          `Bearer ${serviceKey}`,
        ),
      )
      const response = yield* HttpClient.execute(request)
      return {
        status: response.status,
        body: yield* response.json,
      }
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  )
  if (status < 200 || status >= 300) {
    throw new Error(`memento ${path}: HTTP ${status}`)
  }
  return body
}

async function postJson(path: string, body: unknown): Promise<void> {
  const status = await Effect.runPromise(
    Effect.gen(function* () {
      const { baseUrl, serviceKey } = readMementoConfig()
      const request = yield* HttpClientRequest.post(`${baseUrl}${path}`).pipe(
        HttpClientRequest.setHeader(
          "Authorization",
          `Bearer ${serviceKey}`,
        ),
        HttpClientRequest.bodyJson(body),
      )
      const response = yield* HttpClient.execute(request)
      return response.status
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  )
  if (status < 200 || status >= 300) {
    throw new Error(`memento ${path}: HTTP ${status}`)
  }
}
