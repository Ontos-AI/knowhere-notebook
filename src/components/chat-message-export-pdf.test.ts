import { describe, expect, it } from "vitest"

import { createPdfBlobFromMarkdown } from "./chat-message-export-pdf"

describe("createPdfBlobFromMarkdown", () => {
  it("builds a PDF without citation markers", async () => {
    const blob = createPdfBlobFromMarkdown("Revenue grew in the quarter.")
    const text = await blob.text()

    expect(blob.type).toBe("application/pdf")
    expect(text.startsWith("%PDF-1.4")).toBe(true)
    expect(text).toContain("Revenue grew in the quarter.")
    expect(text).not.toContain("[[cite:")
    expect(text).not.toContain("SOURCES")
  })
})
