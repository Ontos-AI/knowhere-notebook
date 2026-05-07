// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SourcesPanel } from "./sources-panel";

const C = SourcesPanel as React.FC<Record<string, unknown>>;

describe("SourcesPanel", () => {
  it("opens the upload dialog from the sidebar trigger", async () => {
    const user = userEvent.setup();

    render(React.createElement(C, { sources: [] }));

    await user.click(screen.getByRole("button", { name: "Upload Document" }));

    expect(screen.getByRole("heading", { name: "Add source" })).toBeTruthy();
    expect(
      screen.getByText(/Click to select or drag and drop a document/),
    ).toBeTruthy();
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

    expect(screen.getByText(/Notebook accepts PDF, DOCX, TXT, MD, and PPTX/)).toBeTruthy();
    expect(opened.container.textContent).not.toMatch(/Knowhere|parsing|indexing/i);
  });

  it("separates source opening from query include toggles", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("checkbox", { name: "Use lecture.pdf in answers" }));

    expect(onToggleIncluded).toHaveBeenCalledWith("source_1", false);
    expect(onSelectSource).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Open lecture.pdf content sections" }),
    );

    expect(onSelectSource).toHaveBeenCalledWith("source_1");
  });
});
