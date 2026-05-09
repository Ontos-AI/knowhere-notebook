// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChunksPanel } from "./chunks-panel";

const C = ChunksPanel as React.FC<Record<string, unknown>>;

describe("ChunksPanel", () => {
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

  it("uses parsed chunk language", () => {
    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "chunk_1",
            type: "text",
            content: "The course starts on Monday.",
            sourceTitle: "lecture.pdf",
          },
        ],
        selectedSource: "lecture.pdf",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Parsed Chunks" }),
    ).toBeTruthy();
    expect(screen.getByText(/Showing all parsed chunks from/)).toBeTruthy();
  });

  it("uses compact, non-folding spacing for the mobile chunk view", () => {
    render(React.createElement(C, { chunks: [] }));

    expect(screen.getByTestId("chunks-panel").className).toContain("min-w-0");
    expect(screen.getByTestId("chunks-scroll-content").className).toContain(
      "p-3",
    );
  });

  it("renders image chunks and scrolls to resolved connection targets", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      React.createElement(C, {
        chunks: [
          {
            chunkId: "text_1",
            parserChunkId: "parser_text_1",
            type: "text",
            content:
              "See [images/image-1.jpg] and [tables/missing.html] for details.",
            sourceTitle: "manual.pdf",
            connections: [
              {
                targetParserChunkId: "parser_image_1",
                targetChunkId: "image_1",
                relation: "embeds",
                ref: "[images/image-1.jpg]",
                position: { start: 4, end: 24 },
              },
              {
                targetParserChunkId: "missing_parser",
                relation: "embeds",
                ref: "[tables/missing.html]",
              },
            ],
          },
          {
            chunkId: "image_1",
            parserChunkId: "parser_image_1",
            type: "image",
            content: "",
            sourceTitle: "manual.pdf",
            summary: "A wiring diagram.",
            assetUrl: "https://blob.example/images/image-1.jpg",
          },
        ],
        selectedSource: "manual.pdf",
      }),
    );

    const image = screen.getByRole("img", { name: "A wiring diagram." });
    expect(image.getAttribute("src")).toBe(
      "https://blob.example/images/image-1.jpg",
    );

    await user.click(screen.getByRole("button", { name: "images/image-1.jpg" }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "tables/missing.html" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
