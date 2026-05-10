// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "./error";

describe("ErrorPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a friendly fallback and lets users retry", async () => {
    const user = userEvent.setup();
    const unstableRetry = vi.fn();

    render(
      React.createElement(ErrorPage, {
        error: new Error("database secret detail"),
        unstable_retry: unstableRetry,
      }),
    );

    expect(screen.getByRole("heading", { name: "Something went wrong" }))
      .toBeTruthy();
    expect(screen.queryByText("database secret detail")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(unstableRetry).toHaveBeenCalledTimes(1);
  });
});
