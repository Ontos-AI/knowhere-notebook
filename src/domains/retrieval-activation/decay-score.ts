/**
 * Time-decay importance score for a retrievable unit (fluid memory item or
 * crystal chunk). Pure function, computed at read time — never persisted —
 * matching OpenViking's approach of not storing a score that would need
 * migration whenever the formula changes.
 *
 * Structure copied from OpenViking's `hotness_score`
 * (`sigmoid(log1p(activationCount)) × exp(-ln2/halfLife × ageDays)`), see
 * `.repos/OpenViking/openviking/retrieve/memory_lifecycle.py`.
 *
 * `BASE_HALF_LIFE_DAYS` is deliberately 2x OpenViking's own default (7
 * days) — a longer grace period before an unused unit's importance
 * meaningfully drops, confirmed against simulated day-counts (see the
 * `记忆衰减聚类收尾方案` plan for the numbers this was checked against).
 *
 * One deviation from OpenViking: the recency half-life grows with
 * `activationCount` instead of staying fixed, borrowing MemoryBank's
 * (arXiv:2305.10250) intuition that repeated recall makes a memory more
 * resistant to forgetting (there, strength `S` is incremented by 1 on every
 * recall and used directly as the decay time constant). Here:
 *
 *   effectiveHalfLifeDays = BASE_HALF_LIFE_DAYS * (1 + activationCount)
 *
 * This does not double-count activationCount with the frequency term: the
 * frequency term sets the score's baseline ceiling for a given activation
 * count, while the half-life growth slows how fast that ceiling erodes as
 * time passes without a new activation.
 *
 * "Reset then decay" (an activation makes the unit feel fresh again, then
 * importance decays again from there) is achieved by the caller advancing
 * `anchorAt` to the activation time on every write — this function only
 * computes the curve from whatever anchor it is given.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 2x OpenViking's DEFAULT_HALF_LIFE_DAYS (7) — see rationale above. */
export const BASE_HALF_LIFE_DAYS = 14

export type DecayScoreInput = {
  /** Total times this unit has been cited into an answer. */
  readonly activationCount: number
  /** Last activation time, or the unit's creation time if never activated. */
  readonly anchorAt: Date
  readonly now: Date
}

/** Always in (0, 1). */
export function computeDecayScore(input: DecayScoreInput): number {
  const activationCount = Math.max(input.activationCount, 0)
  const ageDays = Math.max(
    (input.now.getTime() - input.anchorAt.getTime()) / MS_PER_DAY,
    0,
  )

  const frequency = sigmoid(Math.log1p(activationCount))
  const effectiveHalfLifeDays = BASE_HALF_LIFE_DAYS * (1 + activationCount)
  const decayRate = Math.LN2 / effectiveHalfLifeDays
  const recency = Math.exp(-decayRate * ageDays)

  return frequency * recency
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
