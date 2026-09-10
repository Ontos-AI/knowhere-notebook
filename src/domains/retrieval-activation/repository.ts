import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"

import type { RetrievalUnitType } from "./types"
import { DbClient } from "@/infrastructure/db"
import { retrievalActivations } from "@/infrastructure/db/schema"

export type RecordActivationInput = {
  readonly workspaceId: string
  readonly unitType: RetrievalUnitType
  readonly unitRef: string
}

export type ActivationStats = {
  readonly unitRef: string
  readonly activationCount: number
  readonly lastActivatedAt: Date | null
}

type RetrievalActivationRepository = {
  /**
   * Upsert one activation (+1, lastActivatedAt = now) per distinct unit.
   * Duplicate (workspaceId, unitType, unitRef) entries within `inputs` are
   * collapsed to a single +1 — Postgres rejects a multi-row upsert that
   * would touch the same conflict target twice in one statement, and
   * "cited twice in one answer" should still only count as one activation
   * event for this turn.
   */
  readonly recordActivationsEffect: (
    inputs: readonly RecordActivationInput[],
  ) => Effect.Effect<number, never, DbClient>
  /**
   * Existing ledger rows for a set of unit refs of one type. Units with no
   * row (never activated) are simply absent from the result — the caller
   * treats that as activationCount 0.
   */
  readonly getActivationsEffect: (
    workspaceId: string,
    unitType: RetrievalUnitType,
    unitRefs: readonly string[],
  ) => Effect.Effect<readonly ActivationStats[], never, DbClient>
}

const recordActivationsEffect: RetrievalActivationRepository["recordActivationsEffect"] =
  (inputs) =>
    Effect.gen(function* () {
      const deduped = dedupeInputs(inputs)
      if (deduped.length === 0) return 0

      const db = yield* DbClient
      const written = yield* Effect.promise(() =>
        db
          .insert(retrievalActivations)
          .values(
            deduped.map((input) => ({
              workspaceId: input.workspaceId,
              unitType: input.unitType,
              unitRef: input.unitRef,
              activationCount: 1,
              lastActivatedAt: sql`now()`,
            })),
          )
          .onConflictDoUpdate({
            target: [
              retrievalActivations.workspaceId,
              retrievalActivations.unitType,
              retrievalActivations.unitRef,
            ],
            set: {
              activationCount: sql`${retrievalActivations.activationCount} + 1`,
              lastActivatedAt: sql`now()`,
            },
          })
          .returning({ id: retrievalActivations.id }),
      )
      return written.length
    })

const getActivationsEffect: RetrievalActivationRepository["getActivationsEffect"] =
  (workspaceId, unitType, unitRefs) =>
    Effect.gen(function* () {
      if (unitRefs.length === 0) return []

      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select({
            unitRef: retrievalActivations.unitRef,
            activationCount: retrievalActivations.activationCount,
            lastActivatedAt: retrievalActivations.lastActivatedAt,
          })
          .from(retrievalActivations)
          .where(
            and(
              eq(retrievalActivations.workspaceId, workspaceId),
              eq(retrievalActivations.unitType, unitType),
              inArray(retrievalActivations.unitRef, [...unitRefs]),
            ),
          ),
      )
      return rows
    })

export const retrievalActivationRepository: RetrievalActivationRepository = {
  recordActivationsEffect,
  getActivationsEffect,
}

function dedupeInputs(
  inputs: readonly RecordActivationInput[],
): RecordActivationInput[] {
  const byKey = new Map<string, RecordActivationInput>()
  for (const input of inputs) {
    byKey.set(`${input.workspaceId}\u0000${input.unitType}\u0000${input.unitRef}`, input)
  }
  return [...byKey.values()]
}
