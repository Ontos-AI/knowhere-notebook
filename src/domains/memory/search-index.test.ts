import { describe, expect, it } from "vitest"

import {
  buildMemoryItemTokens,
  buildMemorySearchText,
  tokenizeMemoryText,
} from "./search-index"

describe("tokenizeMemoryText", () => {
  it("splits CJK into single characters and latin into words", () => {
    expect(tokenizeMemoryText("毛利率 PE gross_margin")).toEqual([
      { token: "毛", frequency: 1 },
      { token: "利", frequency: 1 },
      { token: "率", frequency: 1 },
      { token: "pe", frequency: 1 },
      { token: "gross_margin", frequency: 1 },
    ])
  })

  it("counts repeated tokens", () => {
    expect(tokenizeMemoryText("PE pe Pe")).toEqual([
      { token: "pe", frequency: 3 },
    ])
  })

  it("returns empty for whitespace-only input", () => {
    expect(tokenizeMemoryText("   ")).toEqual([])
  })
})

describe("buildMemorySearchText", () => {
  it("indexes indicator name, aliases, and definition", () => {
    expect(
      buildMemorySearchText("indicator_pref", {
        name: "毛利率",
        aliases: ["gross margin"],
        definition: "毛利除以营收",
        polarity: "higher_better",
        importance: "core",
      }),
    ).toBe("毛利率 gross margin 毛利除以营收")
  })

  it("indexes entity name, aliases, and ticker without reason", () => {
    expect(
      buildMemorySearchText("entity_of_interest", {
        name: "英伟达",
        aliases: ["NVIDIA"],
        ticker: "NVDA",
        knowhereDocumentIds: ["doc-1"],
        reason: "一直在跟踪",
      }),
    ).toBe("英伟达 NVIDIA NVDA")
  })

  it("indexes stance statement and scope", () => {
    expect(
      buildMemorySearchText("stance", {
        statement: "做长期投资",
        scope: "宏观短期观点",
        rationale: "美联储短期说法不重要",
      }),
    ).toBe("做长期投资 宏观短期观点")
  })

  it("indexes decision rule when and then", () => {
    expect(
      buildMemorySearchText("decision_rule", {
        when: "毛利率连续两季下滑",
        then: "减仓观望",
        priority: "high",
        rationale: "用户明确说过",
      }),
    ).toBe("毛利率连续两季下滑 减仓观望")
  })
})

describe("buildMemoryItemTokens", () => {
  it("tokenizes the search text of an item", () => {
    const tokens = buildMemoryItemTokens("indicator_pref", {
      name: "PE",
      aliases: [],
      definition: "市盈率",
      polarity: "context",
      importance: "secondary",
    })
    expect(tokens.map((token) => token.token)).toEqual([
      "pe",
      "市",
      "盈",
      "率",
    ])
  })
})
