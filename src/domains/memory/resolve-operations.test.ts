import { describe, expect, it } from "vitest"

import type { MemoryOperations } from "./prompts"
import {
  resolveMemoryOperations,
  toDiffOperation,
} from "./resolve-operations"

const existingItems = [
  {
    id: "item-1",
    kind: "indicator_pref",
    status: "active",
    payload: {
      name: "毛利率",
      aliases: ["gross margin"],
      definition: "毛利占营收的比例",
      polarity: "higher_better",
      importance: "core",
    },
  },
  { id: "item-2", kind: "stance", status: "active" },
  { id: "item-3", kind: "stance", status: "deprecated" },
  {
    id: "item-4",
    kind: "entity_of_interest",
    status: "active",
    payload: {
      name: "英伟达",
      ticker: "NVDA",
      aliases: ["NVIDIA"],
      knowhereDocumentIds: ["doc-earlier"],
      reason: "用户持续跟踪",
    },
  },
] as const

function makeOperations(
  overrides: Partial<MemoryOperations> = {},
): MemoryOperations {
  return {
    indicatorPrefs: [],
    stances: [],
    decisionRules: [],
    entities: [],
    ...overrides,
  }
}

function makeIndicatorEntry(decision: {
  op: "create" | "skip" | "merge" | "deprecate"
  targetItemId?: string
  reason?: string
}) {
  return {
    name: "毛利率",
    aliases: ["gross margin"],
    definition: "毛利占营收的比例",
    polarity: "higher_better" as const,
    importance: "core" as const,
    abstractL0: "用户看重毛利率",
    overviewL1: "用户在分析公司时首先看毛利率。",
    confidence: 0.9,
    decision,
  }
}

describe("resolveMemoryOperations", () => {
  it("passes create through and ignores a stray targetItemId", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          makeIndicatorEntry({ op: "create", targetItemId: "item-1" }),
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({
      op: "create",
      kind: "indicator_pref",
      payload: {
        name: "毛利率",
        aliases: ["gross margin"],
        polarity: "higher_better",
      },
    })
    expect(resolved[0]).not.toHaveProperty("targetItemId")
  })

  it("merges into an existing active item of the same kind", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          makeIndicatorEntry({ op: "merge", targetItemId: "item-1" }),
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]).toMatchObject({
      op: "merge",
      kind: "indicator_pref",
      targetItemId: "item-1",
    })
  })

  it("downgrades merge to skip when the target is missing", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          makeIndicatorEntry({ op: "merge", targetItemId: "item-999" }),
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]).toMatchObject({
      op: "skip",
      kind: "indicator_pref",
    })
    expect(resolved[0]).not.toHaveProperty("targetItemId")
  })

  it("downgrades merge to skip on kind mismatch", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          makeIndicatorEntry({ op: "merge", targetItemId: "item-2" }),
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]?.op).toBe("skip")
  })

  it("downgrades merge to skip when the target is already deprecated", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        stances: [
          {
            statement: "长期持有，忽略短期波动",
            scope: "投资",
            rationale: "用户做长期投资",
            abstractL0: "长期投资立场",
            overviewL1: "用户强调长期持有。",
            confidence: 1,
            decision: { op: "merge", targetItemId: "item-3" },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]?.op).toBe("skip")
  })

  it("keeps deprecate for an active target", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        stances: [
          {
            statement: "美联储短期观点不重要",
            scope: "宏观",
            rationale: "长期投资",
            abstractL0: "不看美联储短期观点",
            overviewL1: "用户认为美联储短期观点权重低。",
            confidence: 1,
            decision: {
              op: "deprecate",
              targetItemId: "item-2",
              reason: "用户改口",
            },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]).toMatchObject({
      op: "deprecate",
      targetItemId: "item-2",
      reason: "用户改口",
    })
  })

  it("filters entity document ids to the turn's referenced documents", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        entities: [
          {
            name: "英伟达",
            ticker: "NVDA",
            aliases: ["NVIDIA"],
            knowhereDocumentIds: ["doc-real", "doc-hallucinated"],
            reason: "用户持续跟踪",
            abstractL0: "用户关注英伟达",
            overviewL1: "用户多次询问英伟达财报。",
            confidence: 0.8,
            decision: { op: "create" },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: ["doc-real"],
    })

    expect(resolved[0]).toMatchObject({
      op: "create",
      kind: "entity_of_interest",
      payload: {
        name: "英伟达",
        knowhereDocumentIds: ["doc-real"],
      },
    })
  })

  it("unions stored document ids when merging an entity", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        entities: [
          {
            name: "英伟达",
            ticker: "NVDA",
            aliases: ["NVDA Corp"],
            knowhereDocumentIds: ["doc-this-turn"],
            reason: "用户持续跟踪",
            abstractL0: "用户关注英伟达",
            overviewL1: "用户多次询问英伟达财报。",
            confidence: 0.9,
            decision: { op: "merge", targetItemId: "item-4" },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: ["doc-this-turn"],
    })

    expect(resolved[0]).toMatchObject({
      op: "merge",
      targetItemId: "item-4",
      payload: {
        aliases: ["NVIDIA", "NVDA Corp"],
        knowhereDocumentIds: ["doc-earlier", "doc-this-turn"],
      },
    })
  })

  it("unions aliases when merging an indicator preference", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          {
            name: "毛利率",
            aliases: ["同比毛利率"],
            definition: "毛利占营收的比例，也看同比",
            polarity: "higher_better" as const,
            importance: "core" as const,
            abstractL0: "毛利率也看同比",
            overviewL1: "用户补充了同比视角。",
            confidence: 1,
            decision: { op: "merge", targetItemId: "item-1" },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]).toMatchObject({
      op: "merge",
      targetItemId: "item-1",
      payload: {
        aliases: ["gross margin", "同比毛利率"],
      },
    })
  })

  it("skips create when the payload has no searchable tokens", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          {
            name: "!!!",
            aliases: [],
            definition: "???",
            polarity: "context" as const,
            importance: "secondary" as const,
            abstractL0: "无效符号",
            overviewL1: "无法检索。",
            confidence: 0.1,
            decision: { op: "create" },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]).toMatchObject({
      op: "skip",
      kind: "indicator_pref",
      reason: "payload has no searchable tokens",
    })
  })

  it("skips merge when the merged payload has no searchable tokens", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        stances: [
          {
            statement: "!!!",
            scope: "???",
            rationale: "...",
            abstractL0: "无效符号",
            overviewL1: "无法检索。",
            confidence: 0.1,
            decision: { op: "merge", targetItemId: "item-2" },
          },
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(resolved[0]).toMatchObject({
      op: "skip",
      kind: "stance",
      reason: "merged payload has no searchable tokens",
    })
  })
})

describe("toDiffOperation", () => {
  it("records create with the inserted item id", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [makeIndicatorEntry({ op: "create" })],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(toDiffOperation(resolved[0]!, "new-id")).toEqual({
      op: "create",
      kind: "indicator_pref",
      summary: "用户看重毛利率",
      itemId: "new-id",
    })
  })

  it("records merge/deprecate with their target item id", () => {
    const resolved = resolveMemoryOperations({
      operations: makeOperations({
        indicatorPrefs: [
          makeIndicatorEntry({ op: "merge", targetItemId: "item-1" }),
        ],
      }),
      existingItems,
      referencedDocumentIds: [],
    })

    expect(toDiffOperation(resolved[0]!)).toEqual({
      op: "merge",
      kind: "indicator_pref",
      summary: "用户看重毛利率",
      itemId: "item-1",
    })
  })
})
