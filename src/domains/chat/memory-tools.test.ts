import { beforeEach, describe, expect, it, vi } from "vitest"

import { DISTILL_DEDUP_CANDIDATES_PER_KIND } from "@/domains/memory/distill-config"
import type { FluidMemoryItem } from "@/infrastructure/db/schema"

const findDedupCandidates = vi.fn()

vi.mock("@/domains/memory/service", () => ({
  memoryService: {
    findDedupCandidates: (...args: unknown[]) => findDedupCandidates(...args),
  },
}))

describe("notebookMemoryTools", () => {
  beforeEach(() => {
    findDedupCandidates.mockReset()
  })

  it("queries all four kinds and assigns mem refs in kind order", async () => {
    findDedupCandidates.mockImplementation(
      async (_workspaceId: string, kind: string) => {
        if (kind === "stance") return [makeMemoryItem({ id: "item_stance" })]
        if (kind === "entity_of_interest") {
          return [makeMemoryItem({ id: "item_entity", kind: "entity_of_interest" })]
        }
        return []
      },
    )
    const { notebookMemoryTools } = await import("./memory-tools")
    const runtime = notebookMemoryTools.createRuntime({
      workspaceId: "workspace_1",
    })

    const response = await runtime.search({ query: "毛利率 英伟达" })

    expect(findDedupCandidates).toHaveBeenCalledTimes(4)
    expect(findDedupCandidates.mock.calls.map((call) => call[1])).toEqual([
      "indicator_pref",
      "stance",
      "decision_rule",
      "entity_of_interest",
    ])
    expect(findDedupCandidates.mock.calls[0]?.[3]).toBe(
      DISTILL_DEDUP_CANDIDATES_PER_KIND,
    )
    expect(response).toEqual({
      query: "毛利率 英伟达",
      items: [
        expect.objectContaining({
          ref: "mem:1",
          itemId: "item_stance",
          kind: "stance",
        }),
        expect.objectContaining({
          ref: "mem:2",
          itemId: "item_entity",
          kind: "entity_of_interest",
        }),
      ],
    })
  })

  it("searches only the requested kinds", async () => {
    findDedupCandidates.mockResolvedValue([])
    const { notebookMemoryTools } = await import("./memory-tools")
    const runtime = notebookMemoryTools.createRuntime({
      workspaceId: "workspace_1",
    })

    await runtime.search({
      query: "PE",
      kinds: ["indicator_pref"],
    })

    expect(findDedupCandidates).toHaveBeenCalledTimes(1)
    expect(findDedupCandidates).toHaveBeenCalledWith(
      "workspace_1",
      "indicator_pref",
      expect.any(Array),
      DISTILL_DEDUP_CANDIDATES_PER_KIND,
    )
  })
})

function makeMemoryItem(
  overrides: Partial<FluidMemoryItem> = {},
): FluidMemoryItem {
  return {
    id: "item_1",
    workspaceId: "workspace_1",
    kind: "stance",
    payload: { statement: "s", scope: "scope", rationale: "r" },
    abstractL0: "abstract",
    overviewL1: "overview",
    sourceMessageId: null,
    confidence: 0.8,
    status: "active",
    deactivationReason: null,
    version: 1,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    updatedAt: new Date("2026-09-10T00:00:00Z"),
    ...overrides,
  }
}
