// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficialLibraryPanel } from "./official-library-panel";

describe("OfficialLibraryPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the dashboard PDF icon for file cards", () => {
    const { container } = render(
      React.createElement(OfficialLibraryPanel, {
        officialLibrarySources: [
          {
            librarySourceId: "financial-spacex-s1",
            categoryId: "financial-reports",
            categoryLabel: "Financial Reports",
            title: "spacex-s1.pdf",
            sourceUrl: "https://example.com/spacex-s1.pdf",
            mimeType: "application/pdf",
            status: "ready",
            demoSourceId: "demo-spacex-s1",
            chunkCount: 922,
          },
        ],
        onOfficialLibrarySourceAdd: vi.fn(),
      }),
    );

    const pdfIcon = container.querySelector<HTMLImageElement>(
      '[data-testid="official-library-pdf-icon"] img',
    );

    expect(pdfIcon?.getAttribute("src")).toBe(
      "/icons/official-library/pdf-document.svg",
    );
    expect(screen.getByText("spacex-s1.pdf")).toBeTruthy();
  });

  it("shows the uploaded category backgrounds in the all-categories view", () => {
    render(
      React.createElement(OfficialLibraryPanel, {
        officialLibrarySources: [
          {
            librarySourceId: "financial-spacex-s1",
            categoryId: "financial-reports",
            categoryLabel: "Financial Reports",
            title: "spacex-s1.pdf",
            sourceUrl: "https://example.com/spacex-s1.pdf",
            mimeType: "application/pdf",
            status: "ready",
            demoSourceId: "demo-spacex-s1",
            chunkCount: 922,
          },
          {
            librarySourceId: "research-transformers",
            categoryId: "research-papers",
            categoryLabel: "Research Papers",
            title: "transformers.pdf",
            sourceUrl: "https://example.com/transformers.pdf",
            mimeType: "application/pdf",
            status: "planned",
          },
          {
            librarySourceId: "stem-calculus",
            categoryId: "stem-books",
            categoryLabel: "STEM Books",
            title: "calculus.pdf",
            sourceUrl: "https://example.com/calculus.pdf",
            mimeType: "application/pdf",
            status: "ready",
            demoSourceId: "demo-calculus",
          },
          {
            librarySourceId: "other-contract",
            categoryId: "other-docs",
            categoryLabel: "Other Docs",
            title: "contract.pdf",
            sourceUrl: "https://example.com/contract.pdf",
            mimeType: "application/pdf",
            status: "ready",
            demoSourceId: "demo-contract",
          },
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(
      screen
        .getByRole("button", { name: "Open Financial Reports" })
        .getAttribute("style"),
    ).toContain("/images/official-library/financial-reports.svg");
    expect(
      screen
        .getByRole("button", { name: "Open Research Papers" })
        .getAttribute("style"),
    ).toContain("/images/official-library/research-papers.svg");
    expect(
      screen
        .getByRole("button", { name: "Open STEM Books" })
        .getAttribute("style"),
    ).toContain("/images/official-library/stem-books.svg");
    expect(
      screen
        .getByRole("button", { name: "Open Other Docs" })
        .getAttribute("style"),
    ).toContain("/images/official-library/other-docs.svg");
  });
});
