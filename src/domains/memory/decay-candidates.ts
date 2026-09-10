import { computeDecayScore } from "@/domains/retrieval-activation/decay-score"

/**
 * Confirmed decay-candidate threshold: at `BASE_HALF_LIFE_DAYS` (14), a
 * never-activated item (ceiling 0.5) crosses this after ~24.3 days of
 * silence; one activated once after ~60 days; one activated 3x after ~135
 * days. Chosen by simulating `computeDecayScore`'s actual day-counts across
 * activation counts and confirming the resulting grace periods, not picked
 * a priori — see the `记忆衰减聚类收尾方案` plan.
 */
export const DEFAULT_DECAY_SCORE_THRESHOLD = 0.15

export type DecayableItem = {
  readonly id: string
  /** Raw `fluid_memory_items.kind` column value — carried through, not validated. */
  readonly kind: string
  readonly createdAt: Date
}

export type ItemActivationStats = {
  readonly activationCount: number
  readonly lastActivatedAt: Date | null
}

export type DecayCandidate = {
  readonly id: string
  readonly kind: string
  readonly score: number
  readonly activationCount: number
}

/**
 * Pure selection: given active fluid_memory items and their (possibly
 * absent) activation ledger rows, return the ones whose decay score is
 * below `scoreThreshold`. Does not decide the threshold itself and does not
 * write anything — per the plan, a decay score crossing the line only
 * produces a *candidate*; moving it to `inactive` is a separate, explicit
 * step (see `memoryRepository.deactivateDecayedItemsEffect`).
 *
 * The anchor for an item with no ledger row (never activated) is its own
 * `createdAt` — a real, meaningful signal here (unlike a crystal chunk,
 * where "no row" means "no signal at all"), so a never-activated item still
 * decays normally from the moment it was created.
 */
export function selectDecayCandidates(input: {
  readonly items: readonly DecayableItem[]
  readonly activationsById: ReadonlyMap<string, ItemActivationStats>
  readonly now: Date
  readonly scoreThreshold: number
}): readonly DecayCandidate[] {
  return input.items.flatMap((item) => {
    const activation = input.activationsById.get(item.id)
    const activationCount = activation?.activationCount ?? 0
    const anchorAt = activation?.lastActivatedAt ?? item.createdAt
    const score = computeDecayScore({
      activationCount,
      anchorAt,
      now: input.now,
    })
    return score < input.scoreThreshold
      ? [{ id: item.id, kind: item.kind, score, activationCount }]
      : []
  })
}
