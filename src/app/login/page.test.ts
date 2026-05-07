// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "./page";

describe("LoginPage", () => {
  it("uses account language instead of implementation details", () => {
    const { container } = render(React.createElement(LoginPage));

    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Use your Knowhere account to continue.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/dashboard/i);
  });
});
