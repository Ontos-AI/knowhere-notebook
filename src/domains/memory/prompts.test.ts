import { describe, expect, it } from "vitest"

import { buildCapturePrompt } from "./prompts"

describe("buildCapturePrompt", () => {
  const prompt = buildCapturePrompt({
    userText: "毛利率是核心。",
    assistantText: "明白。",
    referencedDocumentIds: ["doc-1"],
  })

  it("keeps main instructions domain-agnostic and capture-only", () => {
    const main = prompt.slice(0, prompt.indexOf("## Illustrative examples"))
    expect(main).not.toMatch(/gross margin|市盈率|\bPE\b|Fed|美联储|NVIDIA|英伟达/i)
    expect(main).toContain("RAW OBSERVATIONS")
    expect(main).toContain("Do NOT classify observations into those kinds")
    expect(main).toContain("Do NOT emit any")
    expect(main).toContain("kind / type / category field")
    expect(main).toContain("Do NOT invent")
    expect(main).toContain("create/merge/deprecate operations")
    expect(main).not.toContain("kindHint")
    expect(main).not.toContain("EXISTING MEMORIES")
    expect(main).not.toContain("indicatorPrefs")
    expect(main).not.toContain("decisionRules")
    expect(main).toContain("Write every free-text value")
    expect(main).toMatch(/same\s+language the USER wrote/)
  })

  it("output schema has no early kind classification field", () => {
    const schema = prompt.slice(prompt.indexOf("## Output JSON schema"))
    expect(schema).not.toContain("kindHint")
    expect(schema).toContain("subjectHint")
    expect(schema).toContain("signal")
    expect(schema).toContain("evidenceQuote")
    expect(schema).toContain("confidence")
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

  it("injects turn context and referenced docs; no existing-memory block", () => {
    expect(prompt).toContain("[user]\n毛利率是核心。")
    expect(prompt).toContain("doc-1")
    expect(prompt).not.toContain("## EXISTING MEMORIES")
  })
})
