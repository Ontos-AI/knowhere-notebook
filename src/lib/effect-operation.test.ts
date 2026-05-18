import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { effectOperation } from "./effect-operation"
import { formatUnknownForLog } from "./format-log-value"
import { makeWorkspaceInitialStateFailureFixture } from "@/test/workspace-initial-state-failure-fixture"

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
        "Workspace initial state failed: database connection refused",
      )
      expect(boundaryError.cause).toBe(error)
    }
  })

  it("surfaces driver causes through database query wrappers", async () => {
    const databaseConnectionError = new Error(
      "connect ECONNREFUSED 127.0.0.1:5434",
    )
    const queryError = new Error(
      'Failed query: select "id" from "workspaces" where "user_id" = $1',
      { cause: databaseConnectionError },
    )

    try {
      await Effect.runPromise(
        effectOperation.tryPromise("workspace.load", () =>
          Promise.reject(queryError),
        ),
      )
      throw new Error("Expected operation to fail.")
    } catch (error) {
      const boundaryError = effectOperation.createBoundaryError(
        "Workspace initial state failed",
        error,
      )

      expect(boundaryError.message).toBe(
        "Workspace initial state failed: connect ECONNREFUSED 127.0.0.1:5434",
      )
    }
  })

  it("surfaces deeply nested driver defects through Effect FiberFailure cause objects", () => {
    const failure = makeWorkspaceInitialStateFailureFixture()

    const boundaryError = effectOperation.createBoundaryError(
      "Workspace initial state failed",
      failure.error,
    )

    expect(boundaryError.message).toBe(failure.boundaryMessage)
  })
})
