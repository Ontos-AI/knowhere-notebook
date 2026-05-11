// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatHistorySheet } from "./chat-history-sheet";

describe("ChatHistorySheet", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("selects a thread and asks the sheet to close", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onThreadSelect = vi.fn();

    render(
      React.createElement(ChatHistorySheet, {
        activeThreadId: "thread_1",
        archivingThreadIds: [],
        isCreatingThread: false,
        isLoading: false,
        isOpen: true,
        loadingThreadId: null,
        onOpenChange,
        onThreadSelect,
        threads: [
          {
            id: "thread_2",
            title: "Revenue question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Open Revenue question chat" }),
    );

    expect(onThreadSelect).toHaveBeenCalledWith("thread_2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows row-level loading while archiving a thread", () => {
    render(
      React.createElement(ChatHistorySheet, {
        activeThreadId: "thread_1",
        archivingThreadIds: ["thread_1"],
        isCreatingThread: false,
        isLoading: false,
        isOpen: true,
        loadingThreadId: null,
        onOpenChange: vi.fn(),
        onThreadArchive: vi.fn(),
        threads: [
          {
            id: "thread_1",
            title: "Margin question",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(
      within(
        screen.getByRole("button", { name: "Delete Margin question chat" }),
      ).getByRole("status", { name: "Loading" }),
    ).toBeTruthy();
  });
});
