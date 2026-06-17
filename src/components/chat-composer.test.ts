// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

  it("inserts expert templates and selects the first placeholder for replacement", async () => {
    const user = userEvent.setup();

    render(React.createElement(ChatComposer));

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(
      screen.getByRole("menuitem", { name: /IPO Prospectus Risk Mining/ }),
    );

    const input = screen.getByPlaceholderText(
      "Ask a question about your documents…",
    ) as HTMLTextAreaElement;
    const placeholderStart = input.value.indexOf("[Company Name]");
    const placeholderEnd = placeholderStart + "[Company Name]".length;

    expect(input.value).toContain("prospectus of [Company Name]");
    await waitFor(() => {
      expect(input.selectionStart).toBe(placeholderStart);
      expect(input.selectionEnd).toBe(placeholderEnd);
    });
    expect(screen.queryByTestId("chat-composer-highlight-layer")).toBeNull();

    await user.type(input, "Acme Robotics", { skipClick: true });

    expect(input.value).toContain("prospectus of Acme Robotics");
    expect(input.value).not.toContain("[Company Name]");
  });

  it("highlights placeholders when text is not selected", async () => {
    const user = userEvent.setup();

    render(React.createElement(ChatComposer));

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(
      screen.getByRole("menuitem", { name: /IPO Prospectus Risk Mining/ }),
    );

    const input = screen.getByPlaceholderText(
      "Ask a question about your documents…",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toContain("[Company Name]"));

    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.select(input);

    expect(screen.getByText("[Company Name]").className).toContain(
      "text-primary",
    );
  });

  it("selects a placeholder with one click when the caret lands inside it", async () => {
    const user = userEvent.setup();

    render(React.createElement(ChatComposer));

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(
      screen.getByRole("menuitem", {
        name: /Earnings Call Transcript Analysis/,
      }),
    );

    const input = screen.getByPlaceholderText(
      "Ask a question about your documents…",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toContain("[Company Name]"));

    const placeholderStart = input.value.indexOf("[Company Name]");
    const placeholderEnd = placeholderStart + "[Company Name]".length;
    input.setSelectionRange(placeholderStart + 3, placeholderStart + 3);
    fireEvent.click(input);

    expect(input.selectionStart).toBe(placeholderStart);
    expect(input.selectionEnd).toBe(placeholderEnd);
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
