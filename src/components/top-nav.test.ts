// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
    vi.unstubAllGlobals()
  })

  it("links to the configured Dashboard origin", async () => {
    const user = userEvent.setup()
    const topNavProps: TopNavProps = {
      dashboardUrl: "https://dashboard.example.test",
    }

    render(
      createElement(
        ThemeProvider,
        { attribute: "class" },
        createElement(TopNav, topNavProps),
      ),
    )

    const link = screen.getByRole("link", { name: "Open Dashboard" })

    expect(link.getAttribute("href")).toBe("https://dashboard.example.test")
    await user.click(screen.getByRole("button", { name: "Toggle theme" }))

    expect(screen.getByRole("menuitem", { name: "Light" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Dark" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "System" })).toBeTruthy()
  })
})
