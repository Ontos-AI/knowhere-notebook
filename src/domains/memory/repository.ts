import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"

import { toDiffOperation, type ResolvedMemoryOperation } from "./resolve-operations"
import { buildMemoryItemTokens } from "./search-index"
import type {
  FluidMemoryKind,
  FluidMemoryPayload,
  MemoryDiffOperation,
} from "./types"
import { DbClient } from "@/infrastructure/db"
import {
  fluidMemoryItems,
  fluidMemoryTokens,
  memoryDiffs,
  type FluidMemoryItem,
  type NewFluidMemoryToken,
} from "@/infrastructure/db/schema"

type MemoryRepository = {
  readonly findDedupCandidatesEffect: (
    workspaceId: string,
    kind: FluidMemoryKind,
    tokens: readonly string[],
    limit: number,
  ) => Effect.Effect<FluidMemoryItem[], never, DbClient>
  readonly applyOperationsEffect: (
    workspaceId: string,
    sourceMessageId: string | null,
    operations: readonly ResolvedMemoryOperation[],
  ) => Effect.Effect<readonly MemoryDiffOperation[], never, DbClient>
}

type RawRowsResult<Row> = readonly Row[] | { readonly rows: readonly Row[] }

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

const applyOperationsEffect: MemoryRepository["applyOperationsEffect"] = (
  workspaceId,
  sourceMessageId,
  operations,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db.transaction(async (tx) => {
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
                  status: "deprecated",
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
      }),
    )
  })

export const memoryRepository: MemoryRepository = {
  findDedupCandidatesEffect,
  applyOperationsEffect,
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
