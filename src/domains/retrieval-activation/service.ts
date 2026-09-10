import "server-only"

import {
  retrievalActivationRepository,
  type ActivationStats,
  type RecordActivationInput,
} from "./repository"
import type { RetrievalUnitType } from "./types"
import { databaseRuntime } from "@/domains/workspace/database-runtime"

type RetrievalActivationService = {
  readonly recordActivations: (
    inputs: readonly RecordActivationInput[],
  ) => Promise<number>
  readonly getActivations: (
    workspaceId: string,
    unitType: RetrievalUnitType,
    unitRefs: readonly string[],
  ) => Promise<readonly ActivationStats[]>
}

const recordActivations: RetrievalActivationService["recordActivations"] = (
  inputs,
) =>
  databaseRuntime.runPromise(
    retrievalActivationRepository.recordActivationsEffect(inputs),
  )

const getActivations: RetrievalActivationService["getActivations"] = (
  workspaceId,
  unitType,
  unitRefs,
) =>
  databaseRuntime.runPromise(
    retrievalActivationRepository.getActivationsEffect(
      workspaceId,
      unitType,
      unitRefs,
    ),
  )

export const retrievalActivationService: RetrievalActivationService = {
  recordActivations,
  getActivations,
}
