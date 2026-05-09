// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SourcesPanel } from "./sources-panel";

const C = SourcesPanel as React.FC<Record<string, unknown>>;
const originalResizeObserver = globalThis.ResizeObserver;

describe("SourcesPanel", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        observe(): void { }
        unobserve(): void { }
        disconnect(): void { }
      },
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: originalResizeObserver,
    });
  });

  it("opens the upload dialog from the sidebar trigger", async () => {
    const user = userEvent.setup();

    render(React.createElement(C, { sources: [] }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(screen.getByRole("heading", { name: "Add source" })).toBeTruthy();
    expect(
      screen.getByText(/Click to select or drag and drop a document/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("uses plain product language for empty and upload states", async () => {
    const user = userEvent.setup();

    const { container } = render(React.createElement(C, { sources: [] }));

    expect(screen.getByRole("heading", { name: "Sources" })).toBeTruthy();
    expect(screen.getAllByText("No sources yet.").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/indexed|indexing|parsing/i);

    cleanup();
    const opened = render(React.createElement(C, { sources: [] }));
    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(
      screen.getByText(
        /Notebook accepts PDF, DOC, DOCX, TXT, MD, PPT, PPTX, and more files up to 100 MB/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Max size: 100 MB")).toBeTruthy();
    expect(opened.container.textContent).not.toMatch(/Knowhere|parsing|indexing/i);
  });

  it("separates source opening from query include toggles", async () => {
    const onSelectSource = vi.fn();
    const onToggleIncluded = vi.fn();

    render(
      React.createElement(C, {
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "ready",
            chunkCount: 3,
          },
        ],
        onSelectSource,
        onToggleIncluded,
      }),
    );

    const checkbox = screen.getByRole("checkbox", { name: "Use lecture.pdf in answers" });
    fireEvent.click(checkbox);

    expect(onToggleIncluded).toHaveBeenCalledWith("source_1", false);
    expect(onSelectSource).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Open lecture.pdf parsed chunks" }),
    );

    expect(onSelectSource).toHaveBeenCalledWith("source_1");
    expect(screen.getByText("Processed · 3 chunks")).toBeTruthy();
  });

  it("hides source actions that are not wired", () => {
    render(
      React.createElement(C, {
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "ready",
            chunkCount: 3,
          },
        ],
      }),
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Use lecture.pdf in answers",
    }) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Delete lecture.pdf" }),
    ).toBeNull();
  });

  it("confirms source deletion for source rows that are still processing", async () => {
    const user = userEvent.setup();
    const onArchiveSource = vi.fn();

    render(
      React.createElement(C, {
        sources: [
          {
            id: "source_1",
            title: "lecture.pdf",
            status: "parsing",
            chunkCount: 0,
          },
        ],
        onArchiveSource,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Delete lecture.pdf" }));
    expect(screen.getByRole("heading", { name: "Delete document" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onArchiveSource).toHaveBeenCalledWith("source_1");
  });
});
