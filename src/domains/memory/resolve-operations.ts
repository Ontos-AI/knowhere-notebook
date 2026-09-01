import { buildMemoryItemTokens } from "./search-index"
import type { MemoryOperations } from "./prompts"
import {
  parseFluidMemoryPayload,
  type FluidMemoryKind,
  type FluidMemoryPayload,
  type MemoryDiffOperation,
} from "./types"

/**
 * Pure normalization from raw LLM operations to repository-ready
 * operations. The LLM output already passed zod validation; this layer
 * enforces the invariants the schema cannot express:
 *   - merge/deprecate must target an existing active item of the same kind
 *     (otherwise downgraded to skip — conservative, never fabricates)
 *   - entity knowhereDocumentIds are intersected with the document ids
 *     actually referenced in the turn (the model cannot invent provenance)
 *   - create ignores any targetItemId the model may have emitted
 *   - create/merge payloads must yield at least one lexical token, otherwise
 *     the item could never be retrieved for later dedup
 *   - merge unions aliases (and entity document ids) with the target so
 *     prior search terms / provenance are not wiped by a partial rewrite
 */

export type ResolvedMemoryOperation =
  | {
      readonly op: "create"
      readonly kind: FluidMemoryKind
      readonly payload: FluidMemoryPayload
      readonly abstractL0: string
      readonly overviewL1: string
      readonly confidence: number
      readonly summary: string
      readonly reason?: string
    }
  | {
      readonly op: "skip"
      readonly kind: FluidMemoryKind
      readonly summary: string
      readonly reason?: string
    }
  | {
      readonly op: "merge"
      readonly kind: FluidMemoryKind
      readonly targetItemId: string
      readonly payload: FluidMemoryPayload
      readonly abstractL0: string
      readonly overviewL1: string
      readonly confidence: number
      readonly summary: string
      readonly reason?: string
    }
  | {
      readonly op: "deprecate"
      readonly kind: FluidMemoryKind
      readonly targetItemId: string
      readonly summary: string
      readonly reason?: string
    }

export type ExistingMemoryItemRef = {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly payload?: unknown
}

type CandidateEntry = {
  readonly abstractL0: string
  readonly overviewL1: string
  readonly confidence: number
  readonly decision: {
    readonly op: "create" | "skip" | "merge" | "deprecate"
    readonly targetItemId?: string
    readonly reason?: string
  }
}

const kindToArrayKey = {
  indicator_pref: "indicatorPrefs",
  stance: "stances",
  decision_rule: "decisionRules",
  entity_of_interest: "entities",
} as const

export function resolveMemoryOperations(input: {
  readonly operations: MemoryOperations
  readonly existingItems: readonly ExistingMemoryItemRef[]
  readonly referencedDocumentIds: readonly string[]
}): ResolvedMemoryOperation[] {
  const activeById = new Map(
    input.existingItems
      .filter((item) => item.status === "active")
      .map((item) => [item.id, item] as const),
  )
  const allowedDocumentIds = new Set(input.referencedDocumentIds)

  const resolved: ResolvedMemoryOperation[] = []

  for (const kind of Object.keys(kindToArrayKey) as FluidMemoryKind[]) {
    const entries = input.operations[kindToArrayKey[kind]] as readonly (CandidateEntry &
      Record<string, unknown>)[]

    for (const entry of entries) {
      const summary = entry.abstractL0
      const reason = entry.decision.reason

      if (entry.decision.op === "skip") {
        resolved.push({ op: "skip", kind, summary, ...(reason ? { reason } : {}) })
        continue
      }

      if (entry.decision.op === "merge" || entry.decision.op === "deprecate") {
        const targetId = entry.decision.targetItemId
        const target = targetId ? activeById.get(targetId) : undefined
        if (!target || target.kind !== kind) {
          resolved.push({
            op: "skip",
            kind,
            summary,
            reason: `${entry.decision.op} target missing, inactive, or kind mismatch`,
          })
          continue
        }
        if (entry.decision.op === "deprecate") {
          resolved.push({
            op: "deprecate",
            kind,
            targetItemId: target.id,
            summary,
            ...(reason ? { reason } : {}),
          })
          continue
        }
        const mergePayload = toPayload(kind, entry, allowedDocumentIds)
        if (!mergePayload) {
          resolved.push({
            op: "skip",
            kind,
            summary,
            reason: "merged payload failed validation",
          })
          continue
        }
        const preserved = preserveFieldsOnMerge(
          kind,
          mergePayload,
          target.payload,
        )
        if (!isIndexable(kind, preserved)) {
          resolved.push({
            op: "skip",
            kind,
            summary,
            reason: "merged payload has no searchable tokens",
          })
          continue
        }
        resolved.push({
          op: "merge",
          kind,
          targetItemId: target.id,
          payload: preserved,
          abstractL0: entry.abstractL0,
          overviewL1: entry.overviewL1,
          confidence: entry.confidence,
          summary,
          ...(reason ? { reason } : {}),
        })
        continue
      }

      const createPayload = toPayload(kind, entry, allowedDocumentIds)
      if (!createPayload) {
        resolved.push({
          op: "skip",
          kind,
          summary,
          reason: "payload failed validation",
        })
        continue
      }
      if (!isIndexable(kind, createPayload)) {
        resolved.push({
          op: "skip",
          kind,
          summary,
          reason: "payload has no searchable tokens",
        })
        continue
      }
      resolved.push({
        op: "create",
        kind,
        payload: createPayload,
        abstractL0: entry.abstractL0,
        overviewL1: entry.overviewL1,
        confidence: entry.confidence,
        summary,
        ...(reason ? { reason } : {}),
      })
    }
  }

  return resolved
}

function toPayload(
  kind: FluidMemoryKind,
  entry: Record<string, unknown>,
  allowedDocumentIds: ReadonlySet<string>,
): FluidMemoryPayload | null {
  const candidate: Record<string, unknown> = {
    name: entry.name,
    aliases: entry.aliases,
    definition: entry.definition,
    polarity: entry.polarity,
    importance: entry.importance,
    formulaHint: entry.formulaHint,
    statement: entry.statement,
    scope: entry.scope,
    rationale: entry.rationale,
    when: entry.when,
    then: entry.then,
    priority: entry.priority,
    ticker: entry.ticker,
    reason: entry.reason,
    knowhereDocumentIds: Array.isArray(entry.knowhereDocumentIds)
      ? entry.knowhereDocumentIds.filter(
          (id): id is string =>
            typeof id === "string" && allowedDocumentIds.has(id),
        )
      : [],
  }
  return parseFluidMemoryPayload(kind, candidate)
}

/** Reject payloads that could never be found again by the token index. */
function isIndexable(kind: FluidMemoryKind, payload: FluidMemoryPayload): boolean {
  return buildMemoryItemTokens(kind, payload).length > 0
}

/**
 * Merge replaces the stored payload, but the model only sees this turn.
 * Union aliases (and entity document ids) with the target so earlier search
 * terms / provenance survive a partial rewrite.
 */
function preserveFieldsOnMerge(
  kind: FluidMemoryKind,
  mergedPayload: FluidMemoryPayload,
  existingPayload: unknown,
): FluidMemoryPayload {
  const existing = parseFluidMemoryPayload(kind, existingPayload)
  if (!existing) return mergedPayload

  if (
    kind === "indicator_pref" &&
    "aliases" in mergedPayload &&
    "aliases" in existing
  ) {
    return {
      ...mergedPayload,
      aliases: unionStrings(existing.aliases, mergedPayload.aliases),
    }
  }

  if (
    kind === "entity_of_interest" &&
    "aliases" in mergedPayload &&
    "aliases" in existing &&
    "knowhereDocumentIds" in mergedPayload &&
    "knowhereDocumentIds" in existing
  ) {
    return {
      ...mergedPayload,
      aliases: unionStrings(existing.aliases, mergedPayload.aliases),
      knowhereDocumentIds: unionStrings(
        existing.knowhereDocumentIds,
        mergedPayload.knowhereDocumentIds,
      ),
    }
  }

  return mergedPayload
}

function unionStrings(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return [...new Set([...left, ...right])]
}

/** Diff-audit view of a resolved operation (itemId filled after write). */
export function toDiffOperation(
  operation: ResolvedMemoryOperation,
  itemId?: string,
): MemoryDiffOperation {
  const base = {
    kind: operation.kind,
    summary: operation.summary,
    ...(operation.reason ? { reason: operation.reason } : {}),
  }
  switch (operation.op) {
    case "create":
      return { op: "create", ...base, ...(itemId ? { itemId } : {}) }
    case "merge":
      return { op: "merge", ...base, itemId: operation.targetItemId }
    case "deprecate":
      return { op: "deprecate", ...base, itemId: operation.targetItemId }
    case "skip":
      return { op: "skip", ...base }
  }
}
