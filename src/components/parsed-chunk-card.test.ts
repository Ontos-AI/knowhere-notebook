// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ParsedChunkCard } from "./parsed-chunk-card";

describe("ParsedChunkCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders text chunks with source, summary, content, and keywords", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "text_1",
          type: "text",
          content: "Tesla is adding Supercharging and AI training capacity.",
          sourceTitle: "TSLA-Q4-2025-UPDATE.PDF",
          sectionPath: "Default_Root/TSLA-Q4-2025-UPDATE.PDF-->Capacity",
          summary: "Tesla continues to add capacity.",
          keywords: ["Supercharging", "AI training capacity"],
        },
        isFocused: true,
        onReferenceClick: vi.fn(),
      }),
    );

    expect(screen.getByTestId("chunk-source-panel-text_1").textContent).toContain(
      "Capacity",
    );
    expect(
      screen.getByTestId("chunk-summary-panel-text_1").textContent,
    ).toContain("Tesla continues to add capacity.");
    expect(screen.getByTestId("chunk-content-panel-text_1").textContent).toContain(
      "Tesla is adding Supercharging and AI training capacity.",
    );
    expect(screen.getByTestId("chunk-keywords-panel-text_1").textContent).toContain(
      "AI training capacity",
    );
    expect(screen.getByTestId("chunk-card-shell-text_1").className).toContain(
      "min-w-0",
    );
  });

  it("routes resolved artifact reference clicks to the target chunk", async () => {
    const user = userEvent.setup();
    const onReferenceClick = vi.fn();

    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "text_1",
          type: "text",
          content: "See [images/image-1.jpg] for details.",
          sourceTitle: "manual.pdf",
          connections: [
            {
              targetParserChunkId: "parser_image_1",
              targetChunkId: "image_1",
              relation: "embeds",
              ref: "[images/image-1.jpg]",
              position: { start: 4, end: 24 },
            },
          ],
        },
        isFocused: false,
        onReferenceClick,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Image 1" }));
    expect(onReferenceClick).toHaveBeenCalledWith("image_1");
  });

  it("sanitizes table HTML before rendering", () => {
    render(
      React.createElement(ParsedChunkCard, {
        chunk: {
          chunkId: "table_1",
          type: "table",
          content:
            '<table><tbody><tr><td onclick="alert(1)">Value</td></tr></tbody></table><script>alert(1)</script>',
          sourceTitle: "report.pdf",
        },
        isFocused: false,
        onReferenceClick: vi.fn(),
      }),
    );

    const table = screen.getByTestId("chunk-table-content-table_1");

    expect(table.innerHTML).toContain("Value");
    expect(table.innerHTML).not.toContain("script");
    expect(table.innerHTML).not.toContain("onclick");
  });
});
