import "server-only"

import { and, asc, count, eq, inArray, lt, sql } from "drizzle-orm"
import { Effect } from "effect"

import type { CapturedObservation } from "./observation-types"
import { toDiffOperation, type ResolvedMemoryOperation } from "./resolve-operations"
import { buildMemoryItemTokens } from "./search-index"
import type {
  FluidMemoryDeactivationReason,
  FluidMemoryKind,
  FluidMemoryPayload,
  MemoryDiffOperation,
} from "./types"
import { DbClient, type Db } from "@/infrastructure/db"
import {
  fluidMemoryItems,
  fluidMemoryTokens,
  fluidObservations,
  memoryDiffs,
  type FluidMemoryItem,
  type FluidObservation,
  type NewFluidMemoryToken,
} from "@/infrastructure/db/schema"

export type InsertObservationsInput = {
  readonly workspaceId: string
  readonly sourceMessageId: string | null
  readonly referencedDocumentIds: readonly string[]
  readonly observations: readonly CapturedObservation[]
}

export type ApplyDistillBatchInput = {
  readonly workspaceId: string
  readonly sourceMessageId: string | null
  readonly operations: readonly ResolvedMemoryOperation[]
  readonly observationIds: readonly string[]
}

type MemoryRepository = {
  readonly findDedupCandidatesEffect: (
    workspaceId: string,
    kind: FluidMemoryKind,
    tokens: readonly string[],
    limit: number,
  ) => Effect.Effect<FluidMemoryItem[], never, DbClient>
  readonly insertObservationsEffect: (
    input: InsertObservationsInput,
  ) => Effect.Effect<readonly FluidObservation[], never, DbClient>
  readonly countPendingObservationsEffect: (
    workspaceId: string,
  ) => Effect.Effect<number, never, DbClient>
  readonly listPendingObservationsEffect: (
    workspaceId: string,
    limit: number,
  ) => Effect.Effect<readonly FluidObservation[], never, DbClient>
  readonly applyDistillBatchEffect: (
    input: ApplyDistillBatchInput,
  ) => Effect.Effect<
    {
      readonly diffs: readonly MemoryDiffOperation[]
      readonly consumedCount: number
    },
    never,
    DbClient
  >
  readonly deleteExpiredConsumedObservationsEffect: (
    olderThan: Date,
  ) => Effect.Effect<number, never, DbClient>
  readonly listActiveItemsEffect: (
    workspaceId: string,
  ) => Effect.Effect<
    readonly Pick<FluidMemoryItem, "id" | "kind" | "createdAt">[],
    never,
    DbClient
  >
  /**
   * Move a specific set of active items to `inactive` with reason
   * `decayed` (the activation-decay job's candidates, already confirmed by
   * the caller — this never decides which items on its own). Mirrors the
   * distill `deprecate` write path: drops the item's token rows so it stops
   * surfacing as a dedup candidate.
   */
  readonly deactivateDecayedItemsEffect: (
    workspaceId: string,
    itemIds: readonly string[],
  ) => Effect.Effect<number, never, DbClient>
}

type RawRowsResult<Row> = readonly Row[] | { readonly rows: readonly Row[] }

type TxClient = Parameters<Parameters<Db["transaction"]>[0]>[0]

/**
 * Retrieve the most lexically-similar active items of one kind, ranked by
 * idf-weighted token overlap computed entirely in SQL. Common tokens (high
 * document frequency within this workspace + kind) are down-weighted so a
 * shared rare term outranks several shared filler characters.
 *
 * Token rows only exist for active items (see schema invariant), so no
 * status filter is needed here.
 */
const findDedupCandidatesEffect: MemoryRepository["findDedupCandidatesEffect"] =
  (workspaceId, kind, tokens, limit) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      if (tokens.length === 0 || limit <= 0) return []

      const tokenList = sql.join(
        tokens.map((token) => sql`${token}`),
        sql`, `,
      )

      const scored = yield* Effect.promise(() =>
        db.execute<{ itemId: string }>(sql`
          SELECT t.item_id AS "itemId", SUM(t.frequency::float8 / df.df) AS score
          FROM fluid_memory_tokens t
          JOIN (
            SELECT token, COUNT(DISTINCT item_id)::float8 AS df
            FROM fluid_memory_tokens
            WHERE workspace_id = ${workspaceId}::uuid
              AND kind = ${kind}
              AND token IN (${tokenList})
            GROUP BY token
          ) df ON df.token = t.token
          WHERE t.workspace_id = ${workspaceId}::uuid
            AND t.kind = ${kind}
            AND t.token IN (${tokenList})
          GROUP BY t.item_id
          ORDER BY score DESC
          LIMIT ${limit}
        `),
      )

      const orderedIds = getRawRows(scored).map((row) => row.itemId)
      if (orderedIds.length === 0) return []

      const items = yield* Effect.promise(() =>
        db
          .select()
          .from(fluidMemoryItems)
          .where(inArray(fluidMemoryItems.id, orderedIds)),
      )
      const byId = new Map(items.map((item) => [item.id, item] as const))
      return orderedIds.flatMap((id) => {
        const item = byId.get(id)
        return item ? [item] : []
      })
    })

/**
 * Append-only write of coarse-capture clues. Never touches fluid_memory_items.
 * Empty input is a no-op (returns []). Status is always `pending`.
 */
const insertObservationsEffect: MemoryRepository["insertObservationsEffect"] = (
  input,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    if (input.observations.length === 0) return []

    const documentIds = [...input.referencedDocumentIds]
    return yield* Effect.promise(() =>
      db
        .insert(fluidObservations)
        .values(
          input.observations.map((observation) => ({
            workspaceId: input.workspaceId,
            sourceMessageId: input.sourceMessageId,
            signal: observation.signal,
            evidenceQuote: observation.evidenceQuote,
            subjectHint: observation.subjectHint ?? null,
            referencedDocumentIds: documentIds,
            confidence: observation.confidence,
            status: "pending",
          })),
        )
        .returning(),
    )
  })

const countPendingObservationsEffect: MemoryRepository["countPendingObservationsEffect"] =
  (workspaceId) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
        db
          .select({ value: count() })
          .from(fluidObservations)
          .where(
            and(
              eq(fluidObservations.workspaceId, workspaceId),
              eq(fluidObservations.status, "pending"),
            ),
          ),
      )
      return Number(rows[0]?.value ?? 0)
    })

/**
 * Oldest-first pending batch for distill. Concurrency across distill runs for
 * the same workspace is primarily gated by trigger cooldown + bucketed
 * workflowRunId; consume below is conditional on status still being pending.
 */
const listPendingObservationsEffect: MemoryRepository["listPendingObservationsEffect"] =
  (workspaceId, limit) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      if (limit <= 0) return []
      return yield* Effect.promise(() =>
        db
          .select()
          .from(fluidObservations)
          .where(
            and(
              eq(fluidObservations.workspaceId, workspaceId),
              eq(fluidObservations.status, "pending"),
            ),
          )
          .orderBy(asc(fluidObservations.createdAt))
          .limit(limit),
      )
    })

const applyDistillBatchEffect: MemoryRepository["applyDistillBatchEffect"] = (
  input,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const diffs = await writeOperations(
          tx,
          input.workspaceId,
          input.sourceMessageId,
          input.operations,
        )
        let consumedCount = 0
        if (input.observationIds.length > 0) {
          const consumed = await tx
            .update(fluidObservations)
            .set({
              status: "consumed",
              consumedAt: sql`now()`,
            })
            .where(
              and(
                eq(fluidObservations.workspaceId, input.workspaceId),
                eq(fluidObservations.status, "pending"),
                inArray(fluidObservations.id, [...input.observationIds]),
              ),
            )
            .returning({ id: fluidObservations.id })
          consumedCount = consumed.length
        }
        return { diffs, consumedCount }
      }),
    )
  })

const deleteExpiredConsumedObservationsEffect: MemoryRepository["deleteExpiredConsumedObservationsEffect"] =
  (olderThan) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const deleted = yield* Effect.promise(() =>
        db
          .delete(fluidObservations)
          .where(
            and(
              eq(fluidObservations.status, "consumed"),
              lt(fluidObservations.createdAt, olderThan),
            ),
          )
          .returning({ id: fluidObservations.id }),
      )
      return deleted.length
    })

const listActiveItemsEffect: MemoryRepository["listActiveItemsEffect"] = (
  workspaceId,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db
        .select({
          id: fluidMemoryItems.id,
          kind: fluidMemoryItems.kind,
          createdAt: fluidMemoryItems.createdAt,
        })
        .from(fluidMemoryItems)
        .where(
          and(
            eq(fluidMemoryItems.workspaceId, workspaceId),
            eq(fluidMemoryItems.status, "active"),
          ),
        ),
    )
  })

const deactivateDecayedItemsEffect: MemoryRepository["deactivateDecayedItemsEffect"] =
  (workspaceId, itemIds) =>
    Effect.gen(function* () {
      if (itemIds.length === 0) return 0

      const db = yield* DbClient
      return yield* Effect.promise(() =>
        db.transaction(async (tx) => {
          const updated = await tx
            .update(fluidMemoryItems)
            .set({
              status: "inactive",
              deactivationReason:
                "decayed" satisfies FluidMemoryDeactivationReason,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(fluidMemoryItems.workspaceId, workspaceId),
                eq(fluidMemoryItems.status, "active"),
                inArray(fluidMemoryItems.id, [...itemIds]),
              ),
            )
            .returning({ id: fluidMemoryItems.id })

          if (updated.length > 0) {
            await tx.delete(fluidMemoryTokens).where(
              inArray(
                fluidMemoryTokens.itemId,
                updated.map((item) => item.id),
              ),
            )
          }
          return updated.length
        }),
      )
    })

export const memoryRepository: MemoryRepository = {
  findDedupCandidatesEffect,
  insertObservationsEffect,
  countPendingObservationsEffect,
  listPendingObservationsEffect,
  applyDistillBatchEffect,
  deleteExpiredConsumedObservationsEffect,
  listActiveItemsEffect,
  deactivateDecayedItemsEffect,
}

async function writeOperations(
  tx: TxClient,
  workspaceId: string,
  sourceMessageId: string | null,
  operations: readonly ResolvedMemoryOperation[],
): Promise<MemoryDiffOperation[]> {
  const diffOperations: MemoryDiffOperation[] = []

  for (const operation of operations) {
    switch (operation.op) {
      case "create": {
        const [inserted] = await tx
          .insert(fluidMemoryItems)
          .values({
            workspaceId,
            kind: operation.kind,
            payload: operation.payload,
            abstractL0: operation.abstractL0,
            overviewL1: operation.overviewL1,
            sourceMessageId,
            confidence: operation.confidence,
            status: "active",
          })
          .returning()
        if (inserted?.id) {
          const tokenRows = tokenRowsFor(
            workspaceId,
            inserted.id,
            operation.kind,
            operation.payload,
          )
          if (tokenRows.length > 0) {
            await tx.insert(fluidMemoryTokens).values(tokenRows)
          }
        }
        diffOperations.push(toDiffOperation(operation, inserted?.id))
        break
      }
      case "merge": {
        const [updated] = await tx
          .update(fluidMemoryItems)
          .set({
            payload: operation.payload,
            abstractL0: operation.abstractL0,
            overviewL1: operation.overviewL1,
            confidence: operation.confidence,
            sourceMessageId,
            version: sql`${fluidMemoryItems.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(fluidMemoryItems.id, operation.targetItemId),
              eq(fluidMemoryItems.status, "active"),
            ),
          )
          .returning({ id: fluidMemoryItems.id })
        if (updated) {
          await tx
            .delete(fluidMemoryTokens)
            .where(eq(fluidMemoryTokens.itemId, operation.targetItemId))
          const tokenRows = tokenRowsFor(
            workspaceId,
            operation.targetItemId,
            operation.kind,
            operation.payload,
          )
          if (tokenRows.length > 0) {
            await tx.insert(fluidMemoryTokens).values(tokenRows)
          }
        }
        diffOperations.push(
          updated
            ? toDiffOperation(operation)
            : {
                op: "skip",
                kind: operation.kind,
                summary: operation.summary,
                reason: "merge target no longer active",
              },
        )
        break
      }
      case "deprecate": {
        const [updated] = await tx
          .update(fluidMemoryItems)
          .set({
            status: "inactive",
            deactivationReason: "contradicted" satisfies FluidMemoryDeactivationReason,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(fluidMemoryItems.id, operation.targetItemId),
              eq(fluidMemoryItems.status, "active"),
            ),
          )
          .returning({ id: fluidMemoryItems.id })
        if (updated) {
          await tx
            .delete(fluidMemoryTokens)
            .where(eq(fluidMemoryTokens.itemId, operation.targetItemId))
        }
        diffOperations.push(
          updated
            ? toDiffOperation(operation)
            : {
                op: "skip",
                kind: operation.kind,
                summary: operation.summary,
                reason: "deprecate target no longer active",
              },
        )
        break
      }
      case "skip":
        diffOperations.push(toDiffOperation(operation))
        break
    }
  }

  if (diffOperations.length > 0) {
    await tx.insert(memoryDiffs).values({
      workspaceId,
      sourceMessageId,
      operations: [...diffOperations],
    })
  }

  return diffOperations
}

function tokenRowsFor(
  workspaceId: string,
  itemId: string,
  kind: FluidMemoryKind,
  payload: FluidMemoryPayload,
): NewFluidMemoryToken[] {
  return buildMemoryItemTokens(kind, payload).map((token) => ({
    workspaceId,
    itemId,
    kind,
    token: token.token,
    frequency: token.frequency,
  }))
}

function getRawRows<Row>(value: RawRowsResult<Row>): readonly Row[] {
  if (Array.isArray(value)) return value
  return (value as { readonly rows: readonly Row[] }).rows
}
