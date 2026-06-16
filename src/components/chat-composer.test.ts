// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackNotebookAssistantQuestionSubmitted: vi.fn(),
}));

vi.mock("@/lib/posthog", () => ({
  trackNotebookAssistantQuestionSubmitted:
    mocks.trackNotebookAssistantQuestionSubmitted,
}));

import { ChatComposer } from "./chat-composer";

describe("ChatComposer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(mocks.trackNotebookAssistantQuestionSubmitted).toHaveBeenCalledWith({
      context: undefined,
      threadId: null,
      selectedSourcesCount: 0,
      sourceCountSnapshot: 0,
      messageLength: "Summarize this document".length,
    });
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
      screen.queryByPlaceholderText("Upload a document to start asking questions."),
    ).toBeNull();

    const loginButton = screen.getByRole("button", {
      name: "Log in to start",
    });
    expect(within(loginButton).queryByRole("status")).toBeNull();

    await user.click(loginButton);
    expect(onLoginClick).toHaveBeenCalledOnce();
  });
});
