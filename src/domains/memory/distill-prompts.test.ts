import { describe, expect, it } from "vitest"

import { buildDistillPrompt } from "./distill-prompts"
import type { DistillObservationInput } from "./distill-types"

const observations: DistillObservationInput[] = [
  {
    id: "obs-1",
    signal: "看重毛利率",
    evidenceQuote: "毛利率是核心",
    subjectHint: "毛利率",
    confidence: 0.9,
    referencedDocumentIds: ["doc-1"],
  },
  {
    id: "obs-2",
    signal: "跟踪英伟达",
    evidenceQuote: "英伟达一直在跟踪",
    subjectHint: "英伟达",
    confidence: 0.8,
    referencedDocumentIds: [],
  },
]

describe("buildDistillPrompt", () => {
  it("indicator pass: only indicator schema, no other kind arrays", () => {
    const prompt = buildDistillPrompt("indicator", {
      observations,
      existingItems: [
        {
          id: "item-1",
          kind: "indicator_pref",
          abstractL0: "看重毛利率",
          payloadSummary: "毛利率 — 毛利占营收",
        },
      ],
      referencedDocumentIds: ["doc-1"],
    })

    expect(prompt).toContain("You DISTILL indicator preferences")
    expect(prompt).toContain('"indicatorPrefs"')
    expect(prompt).not.toContain('"stances"')
    expect(prompt).not.toContain('"decisionRules"')
    expect(prompt).not.toContain('"entities"')
    expect(prompt).toContain("never emit")
    expect(prompt).toContain("PENDING OBSERVATIONS")
    expect(prompt).toContain("id=obs-1")
    expect(prompt).toContain("id=obs-2")
    expect(prompt).toContain("看重毛利率")
    expect(prompt).toContain("跟踪英伟达")
    expect(prompt).toContain("id=item-1")
    expect(prompt).toContain("doc-1")
    // All observations go to every pass — no kind routing.
    expect(prompt.indexOf("obs-1")).toBeLessThan(prompt.indexOf("obs-2"))
  })

  it("experience pass: stances+rules only; still sees full observation batch", () => {
    const prompt = buildDistillPrompt("experience", {
      observations,
      existingItems: [],
      referencedDocumentIds: [],
    })

    expect(prompt).toContain("You DISTILL stances and decision rules")
    expect(prompt).toContain('"stances"')
    expect(prompt).toContain('"decisionRules"')
    expect(prompt).not.toContain('"indicatorPrefs"')
    expect(prompt).not.toContain('"entities"')
    expect(prompt).toContain("id=obs-1")
    expect(prompt).toContain("id=obs-2")
    expect(prompt).toContain("(no existing memories yet)")
    expect(prompt).toContain("(no documents referenced in this batch)")
  })

  it("entity pass: entities only; referenced ids from batch", () => {
    const prompt = buildDistillPrompt("entity", {
      observations,
      existingItems: [
        {
          id: "item-4",
          kind: "entity_of_interest",
          abstractL0: "跟踪英伟达",
          payloadSummary: "英伟达 NVDA",
        },
      ],
      referencedDocumentIds: ["doc-1"],
    })

    expect(prompt).toContain("You DISTILL entities of interest")
    expect(prompt).toContain('"entities"')
    expect(prompt).not.toContain('"indicatorPrefs"')
    expect(prompt).not.toContain('"stances"')
    expect(prompt).not.toContain('"decisionRules"')
    expect(prompt).toContain("never invent ids")
    expect(prompt).toContain("id=item-4")
    expect(prompt).toContain("doc-1")
  })

  it("keeps illustrative examples separated from main instructions", () => {
    const prompt = buildDistillPrompt("indicator", {
      observations: [],
      existingItems: [],
      referencedDocumentIds: [],
    })
    const main = prompt.slice(0, prompt.indexOf("## Illustrative examples"))
    expect(main).not.toMatch(/gross margin|市盈率|\bPE\b|Fed|美联储|NVIDIA|英伟达/i)
    expect(prompt).toContain("## Illustrative examples (finance vertical")
    expect(prompt).toContain("(no pending observations)")
  })
})
