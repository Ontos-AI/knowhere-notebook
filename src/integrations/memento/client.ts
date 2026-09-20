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

export type MementoCaptureTurn = {
  readonly userText: string
  readonly assistantText?: string
  readonly sourceMessageId?: string
  readonly referencedDocumentIds?: readonly string[]
}

export type MementoCaptureInput = {
  readonly workspaceId: string
  readonly sessionId: string
  readonly turns: readonly MementoCaptureTurn[]
}

export type MementoActivationInput = {
  readonly workspaceId: string
  readonly unitType: "fluid_memory" | "crystal_chunk"
  readonly unitRef: string
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

export async function recordActivations(
  activations: readonly MementoActivationInput[],
): Promise<void> {
  if (activations.length === 0) return

  try {
    await postJson("/activations", { activations })
  } catch (error) {
    logger.warn("chat: failed to record activations", {
      workspaceId: activations[0]?.workspaceId,
      count: activations.length,
      error: summarizeUnknownError(error),
    })
  }
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
