import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { formatUnknownForLog } from "./format-log-value"

describe("formatUnknownForLog", () => {
  it("includes Error messages and nested causes", () => {
    const error = new Error("workspace initial state failed", {
      cause: new Error("database connection refused"),
    })

    const formatted = formatUnknownForLog(error)

    expect(formatted).toContain("workspace initial state failed")
    expect(formatted).toContain("database connection refused")
  })

  it("includes the original rejection from Effect tryPromise failures", async () => {
    expect.assertions(1)

    try {
      await Effect.runPromise(
        Effect.tryPromise(() =>
          Promise.reject(new Error("Knowhere document list timed out")),
        ),
      )
    } catch (error) {
      expect(formatUnknownForLog(error)).toContain(
        "Knowhere document list timed out",
      )
    }
  })
})
