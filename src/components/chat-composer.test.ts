// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./chat-composer";

describe("ChatComposer", () => {
  afterEach(() => {
    cleanup();
  });

  it("sends trimmed input and clears the composer", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(React.createElement(ChatComposer, { onSend }));

    const input = screen.getByPlaceholderText(
      "Ask a question about your documents…",
    );
    await user.type(input, "  Summarize this document  ");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Summarize this document");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the guest login action instead of the text composer", async () => {
    const user = userEvent.setup();
    const onLoginClick = vi.fn();

    render(
      React.createElement(ChatComposer, {
        isDisabled: true,
        onLoginClick,
      }),
    );

    expect(
      screen.queryByPlaceholderText("Add a ready source to start asking questions."),
    ).toBeNull();

    const loginButton = screen.getByRole("button", {
      name: "Log in to start",
    });
    expect(within(loginButton).queryByRole("status")).toBeNull();

    await user.click(loginButton);
    expect(onLoginClick).toHaveBeenCalledOnce();
  });

  it("inserts expert templates and highlights bracket placeholders", async () => {
    const user = userEvent.setup();

    render(React.createElement(ChatComposer));

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(
      screen.getByRole("menuitem", { name: /IPO Prospectus Risk Mining/ }),
    );

    const input = screen.getByPlaceholderText(
      "Ask a question about your documents…",
    ) as HTMLTextAreaElement;
    expect(input.value).toContain("prospectus of [Company Name]");
    expect(screen.getByText("[Company Name]").className).toContain(
      "text-primary",
    );
  });

  it("renders a larger embedded composer input surface", () => {
    render(React.createElement(ChatComposer));

    const input = screen.getByPlaceholderText(
      "Ask a question about your documents…",
    );

    expect(input.className).toContain("h-[128px]");
    expect(input.className).toContain("border-0");
    expect(input.className).toContain("shadow-none");
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });
});
