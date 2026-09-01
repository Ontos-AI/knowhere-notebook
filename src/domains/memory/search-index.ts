import type {
  DecisionRulePayload,
  EntityOfInterestPayload,
  FluidMemoryKind,
  FluidMemoryPayload,
  IndicatorPreferencePayload,
  StancePayload,
} from "./types"

/**
 * Lexical search-index helpers for fluid memory dedup retrieval.
 *
 * Pure and dependency-free so both the write path (indexing an item) and the
 * read path (turning a turn into a query) share one tokenizer. Tokenization
 * mirrors Knowhere map-nav: lowercase, then emit single CJK characters and
 * `[a-z0-9_]+` runs. This handles Chinese (no whitespace segmentation) and
 * Latin/alphanumeric terms without any Postgres extension.
 */

export type MemoryToken = {
  readonly token: string
  readonly frequency: number
}

// Single CJK char OR a run of latin letters / digits / underscore.
const TOKEN_PATTERN =
  /[a-z0-9_]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g

/**
 * Build the text that represents an item for lexical matching. Only the
 * fields a user would phrase a query against are included (names, aliases,
 * short definitions), not provenance or bookkeeping fields.
 */
export function buildMemorySearchText(
  kind: FluidMemoryKind,
  payload: FluidMemoryPayload,
): string {
  return collectSearchParts(kind, payload)
    .filter((part) => part.length > 0)
    .join(" ")
}

/** Tokenize free text into deduped tokens with occurrence counts. */
export function tokenizeMemoryText(text: string): MemoryToken[] {
  const counts = new Map<string, number>()
  const matches = text.toLowerCase().match(TOKEN_PATTERN)
  if (!matches) return []
  for (const token of matches) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts].map(([token, frequency]) => ({ token, frequency }))
}

/** Tokens that index one memory item (search text of its payload). */
export function buildMemoryItemTokens(
  kind: FluidMemoryKind,
  payload: FluidMemoryPayload,
): MemoryToken[] {
  return tokenizeMemoryText(buildMemorySearchText(kind, payload))
}

function collectSearchParts(
  kind: FluidMemoryKind,
  payload: FluidMemoryPayload,
): readonly string[] {
  switch (kind) {
    case "indicator_pref": {
      const p = payload as IndicatorPreferencePayload
      return [p.name, ...p.aliases, p.definition]
    }
    case "stance": {
      const p = payload as StancePayload
      return [p.statement, p.scope]
    }
    case "decision_rule": {
      const p = payload as DecisionRulePayload
      return [p.when, p.then]
    }
    case "entity_of_interest": {
      const p = payload as EntityOfInterestPayload
      return [p.name, ...p.aliases, ...(p.ticker ? [p.ticker] : [])]
    }
  }
}
