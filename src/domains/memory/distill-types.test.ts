import { describe, expect, it } from "vitest"

import {
  entityDistillOutputSchema,
  experienceDistillOutputSchema,
  indicatorDistillOutputSchema,
  memoryOperationsSchema,
  summarizePayloadForContext,
  toMemoryOperations,
} from "./distill-types"

describe("distill output schemas", () => {
  it("indicator pass accepts prefs and defaults empty array", () => {
    expect(indicatorDistillOutputSchema.parse({})).toEqual({
      indicatorPrefs: [],
    })
    const parsed = indicatorDistillOutputSchema.parse({
      indicatorPrefs: [
        {
          name: "毛利率",
          aliases: [],
          definition: "毛利占营收",
          polarity: "higher_better",
          importance: "core",
          abstractL0: "看重毛利率",
          overviewL1: "用户用毛利率判断质量。",
          confidence: 0.9,
          decision: { op: "create" },
        },
      ],
    })
    expect(parsed.indicatorPrefs).toHaveLength(1)
    expect(parsed).not.toHaveProperty("stances")
  })

  it("experience pass accepts stance+rule when required fields are present", () => {
    const parsed = experienceDistillOutputSchema.parse({
      stances: [
        {
          statement: "长期持有",
          scope: "投资 horizon",
          rationale: "用户明确说长期",
          abstractL0: "长期持有",
          overviewL1: "用户以长期视角评估。",
          confidence: 1,
          decision: { op: "create" },
        },
      ],
      decisionRules: [
        {
          when: "毛利率连续两季下滑",
          then: "减仓观望",
          priority: "high",
          rationale: "用户自述纪律",
          abstractL0: "毛利率下滑则减仓",
          overviewL1: "连续两季下滑时减仓观望。",
          confidence: 0.95,
          decision: { op: "create" },
        },
      ],
    })
    expect(parsed.stances[0]?.statement).toBe("长期持有")
    expect(parsed.decisionRules).toHaveLength(1)
    expect(parsed).not.toHaveProperty("indicatorPrefs")
  })

  it("rejects stance that uses name instead of statement (no coerce)", () => {
    expect(() =>
      experienceDistillOutputSchema.parse({
        stances: [
          {
            name: "长期持有",
            scope: "投资",
            rationale: "用户明确说长期",
            abstractL0: "长期持有",
            overviewL1: "用户以长期视角评估。",
            confidence: 1,
            decision: { op: "create" },
          },
        ],
      }),
    ).toThrow()
  })

  it("rejects entity missing reason (no fill from abstractL0)", () => {
    expect(() =>
      entityDistillOutputSchema.parse({
        entities: [
          {
            name: "英伟达",
            aliases: ["NVIDIA"],
            knowhereDocumentIds: ["doc-1"],
            abstractL0: "持续跟踪英伟达",
            overviewL1: "用户把英伟达列为跟踪标的。",
            confidence: 0.8,
            decision: { op: "merge", targetItemId: "item-4" },
          },
        ],
      }),
    ).toThrow()
  })

  it("entity pass accepts when reason is present", () => {
    const parsed = entityDistillOutputSchema.parse({
      entities: [
        {
          name: "英伟达",
          aliases: ["NVIDIA"],
          knowhereDocumentIds: ["doc-1"],
          reason: "用户持续跟踪",
          abstractL0: "持续跟踪英伟达",
          overviewL1: "用户把英伟达列为跟踪标的。",
          confidence: 0.8,
          decision: { op: "merge", targetItemId: "item-4" },
        },
      ],
    })
    expect(parsed.entities[0]?.reason).toBe("用户持续跟踪")
  })

  it("toMemoryOperations expands each pass into the full four-array record", () => {
    expect(
      toMemoryOperations("indicator", {
        indicatorPrefs: [],
      }),
    ).toEqual({
      indicatorPrefs: [],
      stances: [],
      decisionRules: [],
      entities: [],
    })

    const experience = toMemoryOperations(
      "experience",
      experienceDistillOutputSchema.parse({
        stances: [
          {
            statement: "长期",
            scope: "投资",
            rationale: "用户说的",
            abstractL0: "长期",
            overviewL1: "长期视角。",
            confidence: 1,
            decision: { op: "create" },
          },
        ],
      }),
    )
    expect(experience.stances).toHaveLength(1)
    expect(experience.indicatorPrefs).toEqual([])
    expect(experience.entities).toEqual([])

    const entity = toMemoryOperations(
      "entity",
      entityDistillOutputSchema.parse({
        entities: [
          {
            name: "英伟达",
            aliases: [],
            knowhereDocumentIds: [],
            reason: "跟踪",
            abstractL0: "跟踪英伟达",
            overviewL1: "用户跟踪英伟达。",
            confidence: 0.7,
            decision: { op: "create" },
          },
        ],
      }),
    )
    expect(entity.entities).toHaveLength(1)
    expect(entity.decisionRules).toEqual([])
  })

  it("memoryOperationsSchema parses the full four-array shape", () => {
    const parsed = memoryOperationsSchema.parse({})
    expect(parsed).toEqual({
      indicatorPrefs: [],
      stances: [],
      decisionRules: [],
      entities: [],
    })
  })
})

describe("summarizePayloadForContext", () => {
  it("summarizes each kind for existing-memory context lines", () => {
    expect(
      summarizePayloadForContext("indicator_pref", {
        name: "毛利率",
        definition: "毛利占营收",
      }),
    ).toBe("毛利率 — 毛利占营收")
    expect(
      summarizePayloadForContext("stance", { statement: "长期持有" }),
    ).toBe("长期持有")
    expect(
      summarizePayloadForContext("decision_rule", {
        when: "下滑",
        then: "减仓",
      }),
    ).toBe("下滑 => 减仓")
    expect(
      summarizePayloadForContext("entity_of_interest", {
        name: "英伟达",
        ticker: "NVDA",
      }),
    ).toBe("英伟达 NVDA")
  })
})
