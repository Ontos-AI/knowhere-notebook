import { describe, expect, it } from "vitest"

import { buildMemoryExtractionPrompt } from "./prompts"

describe("buildMemoryExtractionPrompt", () => {
  const prompt = buildMemoryExtractionPrompt({
    userText: "毛利率是核心。",
    assistantText: "明白。",
    referencedDocumentIds: ["doc-1"],
    existingItems: [],
  })

  it("keeps main instructions domain-agnostic", () => {
    const main = prompt.slice(0, prompt.indexOf("## Illustrative examples"))
    expect(main).not.toMatch(/gross margin|市盈率|\bPE\b|Fed|美联储|NVIDIA|英伟达/i)
    expect(main).toContain("Write every free-text value")
    expect(main).toMatch(/same language the\s+USER wrote/)
  })

  it("keeps illustrative examples in a separate section", () => {
    expect(prompt).toContain("## Illustrative examples (finance vertical")
    expect(prompt).toContain("not exhaustive, not required vocabulary")
    const examples = prompt.slice(
      prompt.indexOf("## Illustrative examples"),
      prompt.indexOf("## Output JSON schema"),
    )
    expect(examples).toContain("finance vertical")
    expect(examples).toContain("do not force the conversation into this domain")
  })

  it("still injects turn context after the fixed blocks", () => {
    expect(prompt).toContain("[user]\n毛利率是核心。")
    expect(prompt).toContain("doc-1")
  })
})
