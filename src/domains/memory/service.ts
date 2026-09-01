import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { memoryRepository } from "./repository"
import type { ResolvedMemoryOperation } from "./resolve-operations"
import type { FluidMemoryKind, MemoryDiffOperation } from "./types"
import type { FluidMemoryItem } from "@/infrastructure/db/schema"

type MemoryService = {
  readonly findDedupCandidates: (
    workspaceId: string,
    kind: FluidMemoryKind,
    tokens: readonly string[],
    limit: number,
  ) => Promise<FluidMemoryItem[]>
  readonly applyOperations: (
    workspaceId: string,
    sourceMessageId: string | null,
    operations: readonly ResolvedMemoryOperation[],
  ) => Promise<readonly MemoryDiffOperation[]>
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

const applyOperations: MemoryService["applyOperations"] = (
  workspaceId,
  sourceMessageId,
  operations,
) =>
  databaseRuntime.runPromise(
    memoryRepository.applyOperationsEffect(
      workspaceId,
      sourceMessageId,
      operations,
    ),
  )

export const memoryService: MemoryService = {
  findDedupCandidates,
  applyOperations,
}
