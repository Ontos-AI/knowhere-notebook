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

    const input = getComposerTextArea();
    await user.type(input, "  Summarize this document  ");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Summarize this document", {
      useAgentic: true,
    });
    expect(input.value).toBe("");
  });

  it("defaults to agentic retrieval enabled and explains the toggle", async () => {
    const user = userEvent.setup();

    render(React.createElement(ChatComposer));

    const toggle = screen.getByRole("button", {
      name: "Toggle agentic retrieval",
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    await user.hover(toggle);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain(
      "Agentic retrieval plans document selection and navigation",
    );
  });

  it("sends useAgentic false after toggling agentic retrieval off", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(React.createElement(ChatComposer, { onSend }));

    const toggle = screen.getByRole("button", {
      name: "Toggle agentic retrieval",
    });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    const input = getComposerTextArea();
    await user.type(input, "Quick summary");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Quick summary", {
      useAgentic: false,
    });
  });

  it("caps long prompts and resets the composer after sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(React.createElement(ChatComposer, { onSend }));

    const input = getComposerTextArea();
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => 260,
    });

    fireEvent.change(input, {
      target: {
        value:
          "Line one\nLine two\nLine three\nLine four\nLine five\nLine six\nLine seven\nLine eight",
      },
    });

    await waitFor(() => {
      expect(input.style.height).toBe("192px");
      expect(input.style.overflowY).toBe("auto");
    });

    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(input.value).toBe("");
      expect(input.style.height).toBe("128px");
      expect(input.style.overflowY).toBe("hidden");
    });
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

    const input = getComposerTextArea();
    input.scrollTop = 92;
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(
      screen.getByRole("menuitem", { name: /IPO Prospectus Risk Mining/ }),
    );

    const placeholderStart = input.value.indexOf("[Company Name]");
    const placeholderEnd = placeholderStart + "[Company Name]".length;

    expect(input.value).toContain("prospectus of [Company Name]");
    await waitFor(() => {
      expect(input.selectionStart).toBe(placeholderStart);
      expect(input.selectionEnd).toBe(placeholderEnd);
    });
    expect(document.activeElement).toBe(input);
    expect(input.scrollTop).toBe(0);
    expect(input.className).toContain("text-foreground");
    expect(input.className).not.toContain("text-transparent");
    expect(screen.queryByTestId("chat-composer-highlight-layer")).toBeNull();

    await user.type(input, "Acme Robotics", { skipClick: true });

    expect(input.value).toContain("prospectus of Acme Robotics");
    expect(input.value).not.toContain("[Company Name]");
    expect(input.selectionStart).toBe(
      placeholderStart + "Acme Robotics".length,
    );
    expect(input.selectionEnd).toBe(placeholderStart + "Acme Robotics".length);
    expect(input.className).toContain("text-foreground");
    expect(input.className).not.toContain("text-transparent");
  });

  it("uses native textarea selection without rendering a mirror highlight layer", async () => {
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

    expect(screen.queryByTestId("chat-composer-highlight-layer")).toBeNull();

    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.select(input);

    expect(input.className).toContain("text-foreground");
    expect(input.className).not.toContain("text-transparent");
    expect(screen.queryByTestId("chat-composer-highlight-layer")).toBeNull();
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

    expect(input.className).toContain("min-h-[128px]");
    expect(input.className).toContain("max-h-[192px]");
    expect(input.className).toContain("border-0");
    expect(input.className).toContain("shadow-none");
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });
});

function getComposerTextArea(): HTMLTextAreaElement {
  const element = screen.getByRole("textbox", { name: "Chat message" });
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("Expected the chat composer input to be a textarea.");
  }

  return element;
}
