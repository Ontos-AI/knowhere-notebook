import { describe, expect, it } from "vitest"

import { normalizeMemoryExtractPayload } from "./extract-workflow"

describe("normalizeMemoryExtractPayload", () => {
  it("accepts a complete payload", () => {
    expect(
      normalizeMemoryExtractPayload({
        workspaceId: "ws-1",
        threadId: "th-1",
        userMessageId: "u-1",
        assistantMessageId: "a-1",
      }),
    ).toEqual({
      workspaceId: "ws-1",
      threadId: "th-1",
      userMessageId: "u-1",
      assistantMessageId: "a-1",
    })
  })

  it("rejects missing or blank fields", () => {
    expect(normalizeMemoryExtractPayload(null)).toBeNull()
    expect(
      normalizeMemoryExtractPayload({
        workspaceId: "ws-1",
        threadId: "th-1",
        userMessageId: "u-1",
      }),
    ).toBeNull()
    expect(
      normalizeMemoryExtractPayload({
        workspaceId: "  ",
        threadId: "th-1",
        userMessageId: "u-1",
        assistantMessageId: "a-1",
      }),
    ).toBeNull()
  })
})
