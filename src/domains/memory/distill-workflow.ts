import "server-only"

import type { WorkflowContext } from "@upstash/workflow"

import {
  DISTILL_BATCH_MAX,
  DISTILL_CONSUMED_RETENTION_MS,
  DISTILL_DEDUP_CANDIDATES_PER_KIND,
} from "./distill-config"
import { distillMemoryPass } from "./distill-model"
import {
  summarizePayloadForContext,
  type DistillObservationInput,
  type DistillPassKind,
  type ExistingMemoryContextItem,
  type MemoryOperations,
} from "./distill-types"
import { resolveMemoryOperations } from "./resolve-operations"
import { tokenizeMemoryText } from "./search-index"
import { memoryService } from "./service"
import type { FluidMemoryKind } from "./types"
import { isFluidMemoryKind } from "./types"
import type { FluidMemoryItem, FluidObservation } from "@/infrastructure/db/schema"
import { logger } from "@/lib/logger"

export type MemoryDistillPayload = {
  readonly workspaceId: string
}

type MemoryDistillWorkflowContext = Pick<
  WorkflowContext<MemoryDistillPayload>,
  "run"
>

const PASS_KINDS: readonly {
  readonly pass: DistillPassKind
  readonly kinds: readonly FluidMemoryKind[]
}[] = [
  { pass: "indicator", kinds: ["indicator_pref"] },
  { pass: "experience", kinds: ["stance", "decision_rule"] },
  { pass: "entity", kinds: ["entity_of_interest"] },
]

export function normalizeMemoryDistillPayload(
  raw: unknown,
): MemoryDistillPayload | null {
  if (!raw || typeof raw !== "object") return null
  const workspaceId = getNonEmptyString(
    (raw as Record<string, unknown>).workspaceId,
  )
  if (!workspaceId) return null
  return { workspaceId }
}

/**
 * Periodic distill: pending observations → three typed passes → resolve →
 * write fluid_memory_items and mark the batch consumed. Capture never writes
 * the permanent layer; this job is the only writer.
 */
export async function runMemoryDistillWorkflow(input: {
  readonly context: MemoryDistillWorkflowContext
  readonly payload: MemoryDistillPayload
}): Promise<void> {
  const { context, payload } = input

  const batch = await context.run("select-batch", () =>
    memoryService.listPendingObservations(
      payload.workspaceId,
      DISTILL_BATCH_MAX,
    ),
  )
  if (batch.length === 0) {
    logger.info("memory: distill skipped — no pending observations", {
      workspaceId: payload.workspaceId,
    })
    return
  }

  const observationInputs = batch.map(toDistillObservationInput)
  const referencedDocumentIds = unionDocumentIds(batch)
  const queryTokens = tokenizeBatch(observationInputs)

  const candidatesByKind = await context.run("load-candidates", async () => {
    const result: Partial<Record<FluidMemoryKind, FluidMemoryItem[]>> = {}
    for (const kind of [
      "indicator_pref",
      "stance",
      "decision_rule",
      "entity_of_interest",
    ] as const) {
      result[kind] = await memoryService.findDedupCandidates(
        payload.workspaceId,
        kind,
        queryTokens,
        DISTILL_DEDUP_CANDIDATES_PER_KIND,
      )
    }
    return result
  })

  const passOperations: MemoryOperations[] = []
  for (const { pass, kinds } of PASS_KINDS) {
    const existingItems = kinds.flatMap((kind) =>
      (candidatesByKind[kind] ?? []).flatMap((item) => {
        const mapped = toExistingMemoryContextItem(item)
        return mapped ? [mapped] : []
      }),
    )
    const operations = await context.run(`distill-${pass}`, () =>
      distillMemoryPass({
        pass,
        workspaceId: payload.workspaceId,
        observations: observationInputs,
        existingItems,
        referencedDocumentIds,
      }),
    )
    // Null = model failure for this pass only; other passes still apply.
    if (operations) passOperations.push(operations)
  }

  if (passOperations.length === 0) {
    logger.warn(
      "memory: distill aborted — all passes failed; batch left pending",
      {
        workspaceId: payload.workspaceId,
        batchSize: batch.length,
      },
    )
    return
  }

  const existingItemRefs = Object.values(candidatesByKind)
    .flat()
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      status: item.status,
      payload: item.payload,
    }))

  const resolved = passOperations.flatMap((operations) =>
    resolveMemoryOperations({
      operations,
      existingItems: existingItemRefs,
      referencedDocumentIds,
    }),
  )

  const applied = await context.run("apply-and-consume", () =>
    memoryService.applyDistillBatch({
      workspaceId: payload.workspaceId,
      sourceMessageId: null,
      operations: resolved,
      observationIds: batch.map((row) => row.id),
    }),
  )

  const deleted = await context.run("retention", () =>
    memoryService.deleteExpiredConsumedObservations(
      new Date(Date.now() - DISTILL_CONSUMED_RETENTION_MS),
    ),
  )

  logger.info("memory: distill workflow finished", {
    workspaceId: payload.workspaceId,
    batchSize: batch.length,
    resolvedCount: resolved.length,
    diffCount: applied.diffs.length,
    consumedCount: applied.consumedCount,
    retentionDeleted: deleted,
  })
}

export function toDistillObservationInput(
  row: FluidObservation,
): DistillObservationInput {
  const documentIds = Array.isArray(row.referencedDocumentIds)
    ? row.referencedDocumentIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : []
  return {
    id: row.id,
    signal: row.signal,
    evidenceQuote: row.evidenceQuote,
    subjectHint: row.subjectHint,
    confidence: row.confidence,
    referencedDocumentIds: documentIds,
  }
}

function toExistingMemoryContextItem(
  item: FluidMemoryItem,
): ExistingMemoryContextItem | null {
  if (!isFluidMemoryKind(item.kind)) return null
  return {
    id: item.id,
    kind: item.kind,
    abstractL0: item.abstractL0,
    payloadSummary: summarizePayloadForContext(item.kind, item.payload),
  }
}

function tokenizeBatch(
  observations: readonly DistillObservationInput[],
): string[] {
  const text = observations
    .map((observation) =>
      [observation.signal, observation.subjectHint ?? "", observation.evidenceQuote]
        .filter((part) => part.length > 0)
        .join(" "),
    )
    .join(" ")
  return tokenizeMemoryText(text).map((entry) => entry.token)
}

function unionDocumentIds(rows: readonly FluidObservation[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!Array.isArray(row.referencedDocumentIds)) continue
    for (const id of row.referencedDocumentIds) {
      if (typeof id === "string" && id.length > 0) ids.add(id)
    }
  }
  return [...ids]
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}
