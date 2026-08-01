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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./chat-composer";

const templatePrompts = {
  "ipo-prospectus-risk-mining":
    "You are a risk analyst specializing in IPO pricing. I have uploaded the prospectus of [Company Name].",
  "earnings-call-transcript-analysis":
    "You are a sell-side research analyst preparing a post earnings flash note. I have uploaded the earnings release and earnings call transcript of [Company Name].",
};

const promptTemplatesResponse = [
  {
    id: "ipo-prospectus-risk-mining",
    title: "IPO Prospectus Risk Mining",
    prompt: templatePrompts["ipo-prospectus-risk-mining"],
  },
  {
    id: "earnings-call-transcript-analysis",
    title: "Earnings Call Transcript Analysis",
    prompt: templatePrompts["earnings-call-transcript-analysis"],
  },
];

describe("ChatComposer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => promptTemplatesResponse,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends trimmed input and clears the composer", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(React.createElement(ChatComposer, { onSend }));

    const input = getComposerTextArea();
    await user.type(input, "  Summarize this document  ");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Summarize this document", {
      rerank: true,
      internalRecallK: 30,
      topK: 8,
    });
    expect(input.value).toBe("");
  });

  it("renders retrieval controls with defaults", () => {
    render(React.createElement(ChatComposer));

    const rerankSwitch = screen.getByRole("switch", { name: /^Rerank/ });
    expect(rerankSwitch.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("slider", { hidden: true }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Recall K")).toBeTruthy();
    expect(screen.getByText("Top K")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("sends changed retrieval params when the switch is toggled", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(React.createElement(ChatComposer, { onSend }));

    await user.click(screen.getByRole("switch", { name: /^Rerank/ }));
    await user.type(
      screen.getByPlaceholderText("Ask a question about your documents…"),
      "Question",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("Question", {
      rerank: false,
      internalRecallK: 30,
      topK: 8,
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
    await user.click(screen.getByRole("button", { name: "Prompts / Chart" }));
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

    await user.click(screen.getByRole("button", { name: "Prompts / Chart" }));
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

    await user.click(screen.getByRole("button", { name: "Prompts / Chart" }));
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
    expect(screen.getByRole("button", { name: "Prompts / Chart" })).toBeTruthy();
  });
});

function getComposerTextArea(): HTMLTextAreaElement {
  const element = screen.getByRole("textbox", { name: "Chat message" });
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("Expected the chat composer input to be a textarea.");
  }

  return element;
}
