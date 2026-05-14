import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { effectOperation } from "./effect-operation"
import { formatUnknownForLog } from "./format-log-value"

describe("effectOperation", () => {
  it("adds operation context to Promise failures", async () => {
    try {
      await Effect.runPromise(
        effectOperation.tryPromise("source.list", () =>
          Promise.reject(new Error("database connection refused")),
        ),
      )
      throw new Error("Expected operation to fail.")
    } catch (error) {
      const formatted = formatUnknownForLog(error)

      expect(formatted).toContain("source.list")
      expect(formatted).toContain("database connection refused")
    }
  })

  it("adds operation context to Effect failures and defects", async () => {
    try {
      await Effect.runPromise(
        effectOperation.addContext(
          "source.count",
          Effect.die(new Error("Knowhere document list timed out")),
        ),
      )
      throw new Error("Expected operation to fail.")
    } catch (error) {
      const formatted = formatUnknownForLog(error)

      expect(formatted).toContain("source.count")
      expect(formatted).toContain("Knowhere document list timed out")
    }
  })

  it("creates readable boundary errors from Effect failures", async () => {
    try {
      await Effect.runPromise(
        effectOperation.tryPromise("workspace.load", () =>
          Promise.reject(new Error("database connection refused")),
        ),
      )
      throw new Error("Expected operation to fail.")
    } catch (error) {
      const boundaryError = effectOperation.createBoundaryError(
        "Workspace initial state failed",
        error,
      )

      expect(boundaryError.message).toBe(
        "Workspace initial state failed: Effect operation workspace.load failed",
      )
      expect(boundaryError.cause).toBe(error)
    }
  })
})
