import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { selectDecayCandidates, type DecayCandidate } from "./decay-candidates"
import {
  memoryRepository,
  type ApplyDistillBatchInput,
  type InsertObservationsInput,
} from "./repository"
import type { FluidMemoryKind, MemoryDiffOperation } from "./types"
import { retrievalActivationService } from "@/domains/retrieval-activation/service"
import type {
  FluidMemoryItem,
  FluidObservation,
} from "@/infrastructure/db/schema"

type MemoryService = {
  readonly findDedupCandidates: (
    workspaceId: string,
    kind: FluidMemoryKind,
    tokens: readonly string[],
    limit: number,
  ) => Promise<FluidMemoryItem[]>
  readonly insertObservations: (
    input: InsertObservationsInput,
  ) => Promise<readonly FluidObservation[]>
  readonly countPendingObservations: (workspaceId: string) => Promise<number>
  readonly listPendingObservations: (
    workspaceId: string,
    limit: number,
  ) => Promise<readonly FluidObservation[]>
  readonly applyDistillBatch: (input: ApplyDistillBatchInput) => Promise<{
    readonly diffs: readonly MemoryDiffOperation[]
    readonly consumedCount: number
  }>
  readonly deleteExpiredConsumedObservations: (
    olderThan: Date,
  ) => Promise<number>
  /**
   * Active items whose activation-decay score is below `scoreThreshold`.
   * Read-only — does not change any item's status. The caller decides the
   * threshold and what to do with the result (see
   * `deactivateDecayedItems` to actually move candidates to `inactive`).
   */
  readonly listDecayCandidates: (
    workspaceId: string,
    options: { readonly now: Date; readonly scoreThreshold: number },
  ) => Promise<readonly DecayCandidate[]>
  readonly deactivateDecayedItems: (
    workspaceId: string,
    itemIds: readonly string[],
  ) => Promise<number>
}

const findDedupCandidates: MemoryService["findDedupCandidates"] = (
  workspaceId,
  kind,
  tokens,
  limit,
) =>
  databaseRuntime.runPromise(
    memoryRepository.findDedupCandidatesEffect(
      workspaceId,
      kind,
      tokens,
      limit,
    ),
  )

const insertObservations: MemoryService["insertObservations"] = (input) =>
  databaseRuntime.runPromise(memoryRepository.insertObservationsEffect(input))

const countPendingObservations: MemoryService["countPendingObservations"] = (
  workspaceId,
) =>
  databaseRuntime.runPromise(
    memoryRepository.countPendingObservationsEffect(workspaceId),
  )

const listPendingObservations: MemoryService["listPendingObservations"] = (
  workspaceId,
  limit,
) =>
  databaseRuntime.runPromise(
    memoryRepository.listPendingObservationsEffect(workspaceId, limit),
  )

const applyDistillBatch: MemoryService["applyDistillBatch"] = (input) =>
  databaseRuntime.runPromise(memoryRepository.applyDistillBatchEffect(input))

const deleteExpiredConsumedObservations: MemoryService["deleteExpiredConsumedObservations"] =
  (olderThan) =>
    databaseRuntime.runPromise(
      memoryRepository.deleteExpiredConsumedObservationsEffect(olderThan),
    )

const listDecayCandidates: MemoryService["listDecayCandidates"] = async (
  workspaceId,
  options,
) => {
  const items = await databaseRuntime.runPromise(
    memoryRepository.listActiveItemsEffect(workspaceId),
  )
  if (items.length === 0) return []

  const activations = await retrievalActivationService.getActivations(
    workspaceId,
    "fluid_memory",
    items.map((item) => item.id),
  )
  const activationsById = new Map(
    activations.map((activation) => [
      activation.unitRef,
      {
        activationCount: activation.activationCount,
        lastActivatedAt: activation.lastActivatedAt,
      },
    ]),
  )

  return selectDecayCandidates({
    items,
    activationsById,
    now: options.now,
    scoreThreshold: options.scoreThreshold,
  })
}

const deactivateDecayedItems: MemoryService["deactivateDecayedItems"] = (
  workspaceId,
  itemIds,
) =>
  databaseRuntime.runPromise(
    memoryRepository.deactivateDecayedItemsEffect(workspaceId, itemIds),
  )

export const memoryService: MemoryService = {
  findDedupCandidates,
  insertObservations,
  countPendingObservations,
  listPendingObservations,
  applyDistillBatch,
  deleteExpiredConsumedObservations,
  listDecayCandidates,
  deactivateDecayedItems,
}
