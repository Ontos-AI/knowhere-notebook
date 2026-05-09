// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatPanel } from "./chat-panel";

const C = ChatPanel as React.FC<Record<string, unknown>>;

describe("ChatPanel", () => {
  it("explains answers in plain source-based language", () => {
    const { container } = render(
      React.createElement(C, {
        sourceCount: 2,
      }),
    );

    expect(screen.getByText(/Ask anything about your sources/)).toBeTruthy();
    expect(screen.getByText(/source links/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/grounded|citation/i);
  });

  it("labels assistant evidence as sources used", () => {
    render(
      React.createElement(C, {
        messages: [
          {
            id: "assistant_1",
            role: "assistant",
            content: "The deadline is Monday.",
            citations: [
              {
                chunkType: "text",
                score: 0.9,
                source: {
                  documentId: "doc_1",
                  sourceFileName: "syllabus.pdf",
                  sectionPath: "Schedule",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByText("Sources used")).toBeTruthy();
    expect(screen.queryByText("Citations")).toBeNull();
  });
});
