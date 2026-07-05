import "server-only"

import { Client } from "@upstash/workflow"
import type { ParsedDocumentSyncScheduler } from "@ontos-ai/knowhere-sdk"

import { logger } from "@/lib/logger"

/**
 * A `ParsedDocumentSyncScheduler` whose `schedule` enqueues a durable QStash
 * continuation instead of running the (non-serializable) task closure inline.
 * The SDK schedules a background sync on every storage read-miss; the closure
 * captures a per-request client we cannot serialize across serverless
 * invocations, so we discard it and trigger `/api/sources/parsed-sync`, which
 * rebuilds a parsed-storage client and loops `syncParsedDocument` to completion.
 *
 * The scheduler is pre-bound to a single `{ workspaceId, sourceId, documentId }`
 * because the SDK invokes `schedule(task)` with no arguments. `revisionKey` is
 * intentionally NOT part of the bound identity — the sync route resolves the
 * current revision itself so a scheduler bound before the revision is known
 * still enqueues correctly.
 */

export type ParsedSyncTrigger = (input: {
  readonly url: string
  readonly body: ParsedSyncPayload
  readonly workflowRunId: string
  readonly delaySeconds?: number
}) => Promise<void>

export type ParsedSyncPayload = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly apiKey: string
  readonly revisionKey?: string
  readonly segmentIndex?: number
}

export type CreateParsedDocumentSyncSchedulerInput = {
  readonly workspaceId: string
  readonly sourceId: string
  readonly documentId: string
  readonly apiKey: string
  readonly revisionKey?: string
  readonly trigger?: ParsedSyncTrigger
}

// Bounded per-document guard: the SDK may schedule on every read-miss within a
// single request. The cooldown collapses duplicate same-process enqueues
// without permanently blocking future syncs.
const triggerCooldownMs: number = 60_000
const lastTriggeredAtByKey: Map<string, number> = new Map()

function resolveBaseURL(): string {
  return process.env.NOTEBOOK_PUBLIC_URL ?? "http://localhost:3000"
}

export function getParsedSyncWorkflowRunId(input: {
  readonly documentId: string
  readonly revisionKey: string
  readonly segmentIndex: number
}): string {
  return `${input.documentId}-sync-${input.revisionKey}-${input.segmentIndex}`
}

const defaultTrigger: ParsedSyncTrigger = async (input) => {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    throw new Error("QSTASH_TOKEN is required to schedule parsed document sync.")
  }
  await new Client({ token }).trigger({
    url: input.url,
    body: input.body,
    workflowRunId: input.workflowRunId,
    retries: 3,
    delay: input.delaySeconds,
  })
}

export function getParsedSyncUrl(): string {
  return `${resolveBaseURL()}/api/sources/parsed-sync`
}

/**
 * Enqueue a durable parsed-document sync from outside the SDK read path — used
 * by the reconcile workflow to hand off to the resumable parsed-sync route, and
 * by retry to resume a failed storage sync. Starts at segment 0.
 */
export async function enqueueParsedDocumentSync(
  input: {
    readonly workspaceId: string
    readonly sourceId: string
    readonly documentId: string
    readonly apiKey: string
    readonly revisionKey?: string
    readonly delaySeconds?: number
  },
  trigger: ParsedSyncTrigger = defaultTrigger,
): Promise<void> {
  await trigger({
    url: getParsedSyncUrl(),
    body: { ...input, segmentIndex: 0 },
    workflowRunId: getParsedSyncWorkflowRunId({
      documentId: input.documentId,
      revisionKey: input.revisionKey ?? "initial",
      segmentIndex: 0,
    }),
    delaySeconds: input.delaySeconds,
  })
}

export function createParsedDocumentSyncScheduler(
  input: CreateParsedDocumentSyncSchedulerInput,
): ParsedDocumentSyncScheduler {
  const trigger = input.trigger ?? defaultTrigger
  const cooldownKey = `${input.documentId}|${input.revisionKey ?? "unknown"}`

  return {
    schedule: () => {
      const now = Date.now()
      const lastTriggeredAt = lastTriggeredAtByKey.get(cooldownKey)
      if (
        lastTriggeredAt !== undefined &&
        now - lastTriggeredAt < triggerCooldownMs
      ) {
        return
      }
      lastTriggeredAtByKey.set(cooldownKey, now)

      const url = `${resolveBaseURL()}/api/sources/parsed-sync`
      const workflowRunId = getParsedSyncWorkflowRunId({
        documentId: input.documentId,
        revisionKey: input.revisionKey ?? "initial",
        segmentIndex: 0,
      })
      void trigger({
        url,
        body: {
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          documentId: input.documentId,
          apiKey: input.apiKey,
          revisionKey: input.revisionKey,
          segmentIndex: 0,
        },
        workflowRunId,
      }).catch((error: unknown) => {
        lastTriggeredAtByKey.delete(cooldownKey)
        logger.error("parsed-sync-scheduler: failed to enqueue sync", {
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
          documentId: input.documentId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    },
  }
}
