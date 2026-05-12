// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceRow } from "./source-row";

describe("SourceRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("separates source opening from query include toggles", () => {
    const onSelect = vi.fn();
    const onToggleIncluded = vi.fn();

    render(
      React.createElement(SourceRow, {
        isArchiving: false,
        isSelected: false,
        onArchiveClick: vi.fn(),
        onSelect,
        onToggleIncluded,
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "lecture.pdf",
          status: "ready",
          chunkCount: 3,
        },
      }),
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use lecture.pdf in answers" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open lecture.pdf parsed chunks" }),
    );

    expect(onToggleIncluded).toHaveBeenCalledWith("source_1", false);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByText("Processed · 3 chunks")).toBeTruthy();
  });

  it("shows source archive loading locally", () => {
    render(
      React.createElement(SourceRow, {
        isArchiving: true,
        isSelected: true,
        onArchiveClick: vi.fn(),
        onSelect: vi.fn(),
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "lecture.pdf",
          status: "ready",
          chunkCount: 3,
        },
      }),
    );

    const deleteButton = screen.getByRole("button", {
      name: "Delete lecture.pdf",
    });

    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(deleteButton).getByRole("status", { name: "Loading" }))
      .toBeTruthy();
  });
});
