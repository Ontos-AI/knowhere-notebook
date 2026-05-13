// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: async () => {},
}))

import { LoginContent } from "./page";

describe("LoginPage", () => {
  const originalDashboardOrigin = process.env.DASHBOARD_ORIGIN;
  const originalNotebookPublicURL = process.env.NOTEBOOK_PUBLIC_URL;

  beforeEach(() => {
    process.env.DASHBOARD_ORIGIN = "http://localhost:3000";
    process.env.NOTEBOOK_PUBLIC_URL = "http://localhost:3001";
  });

  afterEach(() => {
    cleanup();

    if (originalDashboardOrigin === undefined) {
      delete process.env.DASHBOARD_ORIGIN;
    } else {
      process.env.DASHBOARD_ORIGIN = originalDashboardOrigin;
    }

    if (originalNotebookPublicURL === undefined) {
      delete process.env.NOTEBOOK_PUBLIC_URL;
    } else {
      process.env.NOTEBOOK_PUBLIC_URL = originalNotebookPublicURL;
    }
  });

  it("links directly to Dashboard login with the Notebook callback URL", async () => {
    render(await LoginContent());

    const link = screen.getByRole("link", { name: "Sign in" });

    expect(link.getAttribute("href")).toBe(
      "http://localhost:3000/login?callbackURL=http%3A%2F%2Flocalhost%3A3001",
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("uses account language instead of implementation details", async () => {
    const { container } = render(await LoginContent());

    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Use your Knowhere account to continue.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/dashboard/i);
  });
});
