import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({
  connection: async () => {},
}))

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
  },
  loadWorkspaceShellInitialState: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}))

vi.mock("@/domains/workspace/initial-state", () => ({
  loadWorkspaceShellInitialState: mocks.loadWorkspaceShellInitialState,
}))

import { HomeContent } from "./page"
import { makeWorkspaceInitialStateFailureFixture } from "@/test/workspace-initial-state-failure-fixture"

describe("Home", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renders the workspace shell from the API-backed initial state", async () => {
    mocks.loadWorkspaceShellInitialState.mockResolvedValue({
      isGuest: true,
      loginUrl: "/login",
      sources: [],
      chatMessages: [],
    })

    const element = await HomeContent()

    expect(React.isValidElement(element)).toBe(true)
    expect(mocks.loadWorkspaceShellInitialState).toHaveBeenCalledOnce()
  })

  it("logs a readable page-load failure before rethrowing", async () => {
    const failure = makeWorkspaceInitialStateFailureFixture()

    mocks.loadWorkspaceShellInitialState.mockRejectedValue(failure.error)

    await expect(HomeContent()).rejects.toThrow(failure.boundaryMessage)
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "workspace: initial state failed",
      {
        error: failure.rootCauseMessage,
      },
    )
  })
})
