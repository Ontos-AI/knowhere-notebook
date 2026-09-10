import { describe, expect, it } from "vitest"

import { BASE_HALF_LIFE_DAYS, computeDecayScore } from "./decay-score"

const NOW = new Date("2026-01-08T00:00:00Z")

describe("computeDecayScore", () => {
  it("scores a freshly anchored, never-activated unit as neutral 0.5", () => {
    // freq = sigmoid(log1p(0)) = sigmoid(0) = 0.5; recency at age 0 = 1.
    const score = computeDecayScore({
      activationCount: 0,
      anchorAt: NOW,
      now: NOW,
    })
    expect(score).toBeCloseTo(0.5, 10)
  })

  it("halves the neutral score after one base half-life with no activations", () => {
    const anchorAt = new Date(
      NOW.getTime() - BASE_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000,
    )
    const score = computeDecayScore({ activationCount: 0, anchorAt, now: NOW })
    expect(score).toBeCloseTo(0.25, 10)
  })

  it("decays monotonically with age for a fixed activation count", () => {
    const dayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)

    const scoreAtDay = computeDecayScore({
      activationCount: 2,
      anchorAt: dayAgo,
      now: NOW,
    })
    const scoreAtWeek = computeDecayScore({
      activationCount: 2,
      anchorAt: weekAgo,
      now: NOW,
    })

    expect(scoreAtDay).toBeGreaterThan(scoreAtWeek)
  })

  it("scores a higher activation count above a lower one at the same age", () => {
    const weekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)

    const lowCount = computeDecayScore({
      activationCount: 1,
      anchorAt: weekAgo,
      now: NOW,
    })
    const highCount = computeDecayScore({
      activationCount: 10,
      anchorAt: weekAgo,
      now: NOW,
    })

    expect(highCount).toBeGreaterThan(lowCount)
  })

  it("resets toward the frequency ceiling immediately after a fresh activation", () => {
    // A unit with a long activation history but an activation just now
    // should score close to its frequency ceiling, not its pre-reset decay.
    const score = computeDecayScore({
      activationCount: 5,
      anchorAt: NOW,
      now: NOW,
    })
    const frequencyCeiling = 1 / (1 + Math.exp(-Math.log1p(5)))
    expect(score).toBeCloseTo(frequencyCeiling, 10)
  })

  it("stays within (0, 1) across a range of counts and ages", () => {
    const activationCounts = [0, 1, 3, 10, 50]
    const ageDaysList = [0, 1, 7, 30, 365]

    for (const activationCount of activationCounts) {
      for (const ageDays of ageDaysList) {
        const anchorAt = new Date(
          NOW.getTime() - ageDays * 24 * 60 * 60 * 1000,
        )
        const score = computeDecayScore({ activationCount, anchorAt, now: NOW })
        expect(score).toBeGreaterThan(0)
        expect(score).toBeLessThan(1)
      }
    }
  })

  it("clamps negative age (anchor in the future) to zero elapsed time", () => {
    const future = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    const score = computeDecayScore({
      activationCount: 0,
      anchorAt: future,
      now: NOW,
    })
    expect(score).toBeCloseTo(0.5, 10)
  })
})
