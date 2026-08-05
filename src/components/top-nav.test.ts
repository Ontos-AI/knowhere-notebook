// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/auth/logout/actions", () => ({
  logoutAction: vi.fn(),
}))

import { ThemeProvider } from "@/components/theme-provider"
import { TopNav, type TopNavProps } from "./top-nav"

describe("TopNav", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("shows the user name and a sign-out button when a user is present", async () => {
    const topNavProps: TopNavProps = {
      userInitials: "GD",
      userName: "Gordon",
    }

    render(
      createElement(
        ThemeProvider,
        { attribute: "class" },
        createElement(TopNav, topNavProps),
      ),
    )

    expect(screen.getByText("Gordon")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy()
  })

  it("does not show sign-out when no user is present", () => {
    render(
      createElement(
        ThemeProvider,
        { attribute: "class" },
        createElement(TopNav, {}),
      ),
    )

    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull()
  })
})
