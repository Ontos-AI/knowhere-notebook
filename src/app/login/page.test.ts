// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  connection: async () => {},
}))

import { LoginContent } from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a local email + password form", async () => {
    render(await LoginContent());

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Sign in with your Notebook account.")).toBeTruthy();
  });

  it("uses account language instead of implementation details", async () => {
    const { container } = render(await LoginContent());

    expect(container.textContent).not.toMatch(/dashboard/i);
    expect(container.textContent).not.toMatch(/better.auth/i);
  });
});
