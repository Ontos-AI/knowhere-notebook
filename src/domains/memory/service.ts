import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import {
  memoryRepository,
  type ApplyDistillBatchInput,
  type InsertObservationsInput,
} from "./repository"
import type { FluidMemoryKind, MemoryDiffOperation } from "./types"
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

export const memoryService: MemoryService = {
  findDedupCandidates,
  insertObservations,
  countPendingObservations,
  listPendingObservations,
  applyDistillBatch,
  deleteExpiredConsumedObservations,
}
