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
    mocks.loadWorkspaceShellInitialState.mockRejectedValue(
      new Error("database connection refused"),
    )

    await expect(HomeContent()).rejects.toThrow(
      "Workspace initial state failed: database connection refused",
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "workspace: initial state failed",
      expect.objectContaining({
        error: expect.stringContaining("database connection refused"),
      }),
    )
  })
})
