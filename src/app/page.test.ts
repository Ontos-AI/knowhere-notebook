import React from "react"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loadWorkspaceShellInitialState: vi.fn(),
}))

vi.mock("@/domains/workspace/initial-state", () => ({
  loadWorkspaceShellInitialState: mocks.loadWorkspaceShellInitialState,
}))

import Home from "./page"

describe("Home", () => {
  it("renders the workspace shell from the API-backed initial state", async () => {
    mocks.loadWorkspaceShellInitialState.mockResolvedValue({
      isGuest: true,
      loginUrl: "/login",
      sources: [],
      chatMessages: [],
    })

    const element = await Home()

    expect(React.isValidElement(element)).toBe(true)
    expect(mocks.loadWorkspaceShellInitialState).toHaveBeenCalledOnce()
  })
})
