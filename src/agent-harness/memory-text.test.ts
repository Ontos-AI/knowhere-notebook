import { describe, expect, it } from "vitest"

import { memoryToolText } from "./memory-text"

describe("memoryToolText", () => {
  it("formats search results with memory refs and stored summaries", () => {
    const text = memoryToolText.formatSearch({
      query: "毛利率",
      items: [
        {
          ref: "mem:1",
          itemId: "item_1",
          kind: "stance",
          abstractL0: "关注毛利率下滑",
          overviewL1: "用户把毛利率当作核心观察指标。",
        },
      ],
    })

    expect(text).toContain('<memory operation="search" status="ok">')
    expect(text).toContain('query="毛利率"')
    expect(text).toContain('ref="mem:1"')
    expect(text).toContain('itemId="item_1"')
    expect(text).toContain('kind="stance"')
    expect(text).toContain("关注毛利率下滑")
    expect(text).toContain("用户把毛利率当作核心观察指标。")
  })

  it("formats an empty search without inventing items", () => {
    const text = memoryToolText.formatSearch({
      query: "unknown",
      items: [],
    })

    expect(text).toContain('resultCount="0"')
    expect(text).not.toContain("<item ")
  })
})
