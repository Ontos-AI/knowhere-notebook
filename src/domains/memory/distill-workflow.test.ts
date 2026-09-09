import { describe, expect, it } from "vitest"

import {
  normalizeMemoryDistillPayload,
  toDistillObservationInput,
} from "./distill-workflow"
import type { FluidObservation } from "@/infrastructure/db/schema"

describe("normalizeMemoryDistillPayload", () => {
  it("accepts a workspace id", () => {
    expect(normalizeMemoryDistillPayload({ workspaceId: "ws-1" })).toEqual({
      workspaceId: "ws-1",
    })
  })

  it("rejects missing or blank workspace id", () => {
    expect(normalizeMemoryDistillPayload(null)).toBeNull()
    expect(normalizeMemoryDistillPayload({})).toBeNull()
    expect(normalizeMemoryDistillPayload({ workspaceId: "  " })).toBeNull()
  })
})

describe("toDistillObservationInput", () => {
  it("maps a pending row without inventing fields", () => {
    const row = {
      id: "obs-1",
      workspaceId: "ws-1",
      sourceMessageId: "msg-1",
      signal: "看重毛利率",
      evidenceQuote: "毛利率是核心",
      subjectHint: "毛利率",
      referencedDocumentIds: ["doc-1", ""],
      confidence: 0.9,
      status: "pending",
      createdAt: new Date("2026-06-30T00:00:00.000Z"),
      consumedAt: null,
    } as FluidObservation

    expect(toDistillObservationInput(row)).toEqual({
      id: "obs-1",
      signal: "看重毛利率",
      evidenceQuote: "毛利率是核心",
      subjectHint: "毛利率",
      confidence: 0.9,
      referencedDocumentIds: ["doc-1"],
    })
  })
})
