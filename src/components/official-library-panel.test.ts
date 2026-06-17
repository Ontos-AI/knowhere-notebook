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

    fireEvent.click(
      screen.getByRole("button", { name: "Open Financial Reports" }),
    );

    const pdfIcon = container.querySelector<HTMLImageElement>(
      '[data-testid="official-library-pdf-icon"] img',
    );

    expect(pdfIcon?.getAttribute("src")).toBe(
      "/icons/official-library/pdf-document.svg",
    );
    expect(screen.getByText("spacex-s1.pdf")).toBeTruthy();
  });

  it("renders the header back button", () => {
    const onBack = vi.fn();
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
        onBack,
      }),
    );

    const backButton = screen.getByRole("button", { name: "Back to sources" });
    const backIcon = container.querySelector<SVGSVGElement>(
      '[data-testid="official-library-back-icon"]',
    );

    expect(backIcon?.className.baseVal).toContain("lucide-rotate-ccw");
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("opens library documents as browser PDF previews", () => {
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
        ],
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Financial Reports" }),
    );

    const previewLink = screen.getByRole("link", {
      name: "Open spacex-s1.pdf PDF preview",
    });

    expect(previewLink.getAttribute("href")).toBe(
      "https://example.com/spacex-s1.pdf",
    );
    expect(previewLink.getAttribute("target")).toBe("_blank");
    expect(previewLink.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps file add actions visible on mobile", () => {
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
        ],
        onOfficialLibrarySourceAdd: vi.fn(),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Financial Reports" }),
    );

    const addButton = screen.getByRole("button", {
      name: "Add spacex-s1.pdf to sources",
    });

    expect(addButton.className).toContain("opacity-100");
    expect(addButton.className).toContain("min-[1116px]:opacity-0");
  });

  it("marks already added library documents and removes duplicate add actions", () => {
    const onOfficialLibrarySourceAdd = vi.fn();

    render(
      React.createElement(OfficialLibraryPanel, {
        sources: [
          {
            id: "source_spacex",
            kind: "workspace",
            demoSourceId: "demo-spacex-s1",
            title: "spacex-s1.pdf",
            status: "ready",
            mimeType: "application/pdf",
            documentId: "doc_user_copy",
          },
        ],
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
        onOfficialLibrarySourceAdd,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Financial Reports" }),
    );

    expect(screen.getByLabelText("spacex-s1.pdf already added")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add spacex-s1.pdf to sources" }),
    ).toBeNull();
    expect(onOfficialLibrarySourceAdd).not.toHaveBeenCalled();
  });

  it("opens to the all-categories view", () => {
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
