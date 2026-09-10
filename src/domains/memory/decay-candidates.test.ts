import { describe, expect, it } from "vitest"

import { selectDecayCandidates } from "./decay-candidates"

const NOW = new Date("2026-01-08T00:00:00Z")
const A_YEAR_AGO = new Date("2025-01-08T00:00:00Z")

describe("selectDecayCandidates", () => {
  it("flags an old, never-activated item below the threshold", () => {
    const candidates = selectDecayCandidates({
      items: [{ id: "item_1", kind: "stance", createdAt: A_YEAR_AGO }],
      activationsById: new Map(),
      now: NOW,
      scoreThreshold: 0.3,
    })

    expect(candidates).toEqual([
      { id: "item_1", kind: "stance", score: expect.any(Number), activationCount: 0 },
    ])
    expect(candidates[0]!.score).toBeLessThan(0.3)
  })

  it("does not flag a freshly created item even with no activations", () => {
    const candidates = selectDecayCandidates({
      items: [{ id: "item_1", kind: "stance", createdAt: NOW }],
      activationsById: new Map(),
      now: NOW,
      scoreThreshold: 0.3,
    })

    expect(candidates).toEqual([])
  })

  it("does not flag an old item that was recently activated", () => {
    const candidates = selectDecayCandidates({
      items: [{ id: "item_1", kind: "stance", createdAt: A_YEAR_AGO }],
      activationsById: new Map([
        ["item_1", { activationCount: 3, lastActivatedAt: NOW }],
      ]),
      now: NOW,
      scoreThreshold: 0.3,
    })

    expect(candidates).toEqual([])
  })

  it("only flags items strictly below the given threshold", () => {
    const items = [
      { id: "item_1", kind: "stance" as const, createdAt: A_YEAR_AGO },
      { id: "item_2", kind: "stance" as const, createdAt: NOW },
    ]

    const noneFlagged = selectDecayCandidates({
      items,
      activationsById: new Map(),
      now: NOW,
      scoreThreshold: 0,
    })
    expect(noneFlagged).toEqual([])

    const allFlagged = selectDecayCandidates({
      items,
      activationsById: new Map(),
      now: NOW,
      scoreThreshold: 1,
    })
    expect(allFlagged.map((c) => c.id).sort()).toEqual(["item_1", "item_2"])
  })
})
