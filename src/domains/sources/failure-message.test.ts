import { describe, expect, it } from "vitest"

import { sourceFailureMessage } from "./failure-message"

describe("sourceFailureMessage", () => {
  it("extracts the SDK rate-limit message from retry log text", () => {
    const message = sourceFailureMessage.fromStoredReason(`
Retry attempt 1 for POST /v1/jobs: Error [RateLimitError]: Too many concurrent requests (2/2 active). Please retry after 30 seconds.
    at iM.handleError (.next/server/chunks/_11555_5._.js:3:44260)
statusCode: 429,
code: 'RESOURCE_EXHAUSTED',
`)

    expect(message).toBe(
      "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
    )
  })

  it("caps long stored failure messages", () => {
    const message = sourceFailureMessage.fromStoredReason("x".repeat(220))

    expect(message).toHaveLength(180)
    expect(message?.endsWith("...")).toBe(true)
  })

  it("prefers nested API error messages when available", () => {
    const message = sourceFailureMessage.fromUnknown(
      {
        body: {
          error: {
            message: "Too many concurrent requests.",
          },
        },
      },
      "Knowhere upload failed.",
    )

    expect(message).toBe("Too many concurrent requests.")
  })
})
