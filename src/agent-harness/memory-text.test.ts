import { describe, expect, it } from "vitest"

import { memoryToolText } from "./memory-text"

describe("memoryToolText", () => {
  it("formats search results with memory refs and stored text", () => {
    const text = memoryToolText.formatSearch({
      query: "毛利率",
      items: [
        {
          ref: "mem:1",
          itemId: "item_1",
          kind: "stance",
          text: "关注毛利率下滑 用户把毛利率当作核心观察指标。",
        },
      ],
    })

    expect(text).toContain('<memory operation="search" status="ok">')
    expect(text).toContain('query="毛利率"')
    expect(text).toContain('ref="mem:1"')
    expect(text).not.toContain("itemId")
    expect(text).toContain('kind="stance"')
    expect(text).toContain("关注毛利率下滑 用户把毛利率当作核心观察指标。")
  })

  it("formats an empty search without inventing items", () => {
    const text = memoryToolText.formatSearch({
      query: "unknown",
      items: [],
    })

    expect(text).toContain('resultCount="0"')
    expect(text).not.toContain("<item ")
  })

  it("formats a search failure as a warning", () => {
    const text = memoryToolText.formatWarning({
      operation: "search",
      message: "MEMENTO_BASE_URL is required.",
    })

    expect(text).toContain('<memory operation="search" status="warning">')
    expect(text).toContain("MEMENTO_BASE_URL is required.")
    expect(text).not.toContain('status="error"')
  })
})
