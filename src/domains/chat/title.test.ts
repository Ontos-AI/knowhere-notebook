import { describe, expect, it } from "vitest"

import { deriveChatThreadTitle } from "./title"

describe("deriveChatThreadTitle", () => {
  it("uses the first user message as a compact chat title", () => {
    expect(deriveChatThreadTitle("  What changed in Q4 revenue?\n\nTell me.  "))
      .toBe("What changed in Q4 revenue? Tell me.")
  })

  it("falls back for empty messages and truncates long titles", () => {
    expect(deriveChatThreadTitle("   ")).toBe("New chat")
    expect(deriveChatThreadTitle("a".repeat(90))).toBe(
      `${"a".repeat(77)}...`,
    )
  })
})
