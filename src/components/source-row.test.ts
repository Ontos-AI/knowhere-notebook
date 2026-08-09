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

  it("shows failed source retry with a brief error message", () => {
    const onRetryClick = vi.fn();
    const onSelect = vi.fn();

    render(
      React.createElement(SourceRow, {
        isArchiving: false,
        isSelected: false,
        onRetryClick,
        onSelect,
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "lecture.pdf",
          status: "failed",
          failureMessage:
            "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
          originalFile: {
            url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
            mimeType: "application/pdf",
          },
        },
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry lecture.pdf processing",
      }),
    );

    expect(
      screen.getByText(
        "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
      ),
    ).toBeTruthy();
    expect(onRetryClick).toHaveBeenCalledWith("source_1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows failed source retry loading locally", () => {
    render(
      React.createElement(SourceRow, {
        isArchiving: false,
        isRetrying: true,
        isSelected: false,
        onRetryClick: vi.fn(),
        onSelect: vi.fn(),
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "lecture.pdf",
          status: "failed",
          originalFile: {
            url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
            mimeType: "application/pdf",
          },
        },
      }),
    );

    const retryButton = screen.getByRole("button", {
      name: "Retry lecture.pdf processing",
    });

    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(retryButton).getByRole("status", { name: "Loading" }))
      .toBeTruthy();
  });

  it("hides retry when a failed source has no saved original file", () => {
    render(
      React.createElement(SourceRow, {
        isArchiving: false,
        isSelected: false,
        onRetryClick: vi.fn(),
        onSelect: vi.fn(),
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "legacy.pdf",
          status: "failed",
        },
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Retry legacy.pdf processing",
      }),
    ).toBeNull();
  });

  it("opens chunks overlay for ready sources via tree button", () => {
    const onSelect = vi.fn();
    const onTreeClick = vi.fn();

    render(
      React.createElement(SourceRow, {
        onTreeClick,
        isArchiving: false,
        isSelected: false,
        onSelect,
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "lecture.pdf",
          status: "ready",
          chunkCount: 3,
        },
      }),
    );

    const treeButton = screen.getByRole("button", {
      name: "Open lecture.pdf chunk tree link",
    });

    fireEvent.click(treeButton);
    expect(onTreeClick).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not show tree button for non-ready sources", () => {
    render(
      React.createElement(SourceRow, {
        onTreeClick: vi.fn(),
        isArchiving: false,
        isSelected: false,
        onSelect: vi.fn(),
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "lecture.pdf",
          status: "parsing",
          chunkCount: 0,
        },
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Open lecture.pdf chunk tree link",
      }),
    ).toBeNull();
  });

  it("keeps the title truncating while the delete action stays in a trailing column", () => {
    const { container } = render(
      React.createElement(SourceRow, {
        isArchiving: false,
        isSelected: true,
        onArchiveClick: vi.fn(),
        onSelect: vi.fn(),
        source: {
          id: "source_1",
          mimeType: "application/pdf",
          title: "very-long-quarterly-report-filename.pdf",
          status: "ready",
          chunkCount: 3,
        },
      }),
    );

    const row = container.querySelector("[data-testid='source-row']");
    const deleteButton = screen.getByRole("button", {
      name: "Delete very-long-quarterly-report-filename.pdf",
    });

    expect(row?.className).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(
      screen.getByText("very-long-quarterly-report-filename.pdf").className,
    ).toContain("truncate");
    expect(deleteButton.className).toContain("shrink-0");
  });
});
