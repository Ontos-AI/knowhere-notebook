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

  it("links ready sources to the document chunk tree route", () => {
    const onSelect = vi.fn();

    render(
      React.createElement(SourceRow, {
        chunkTreeHref: "/inspect/doc_123/chunks",
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

    const chunkTreeLink = screen.getByRole("link", {
      name: "Open lecture.pdf chunk tree link",
    });

    expect((chunkTreeLink as HTMLAnchorElement).getAttribute("href")).toBe(
      "/inspect/doc_123/chunks",
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not link non-ready sources to the document chunk tree route", () => {
    render(
      React.createElement(SourceRow, {
        chunkTreeHref: "/inspect/doc_123/chunks",
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
      screen.queryByRole("link", {
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
