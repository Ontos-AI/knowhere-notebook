// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatDiagramCard } from "./chat-diagram-card";

describe("ChatDiagramCard", () => {
  it("renders signed bar values instead of clamping losses to zero", () => {
    const { container } = render(
      React.createElement(ChatDiagramCard, {
        diagram: {
          type: "bar",
          source: "chart-visualization-skills",
          title: "Quarterly Profit",
          data: [
            { category: "Q1", value: -5 },
            { category: "Q2", value: 10 },
          ],
        },
      }),
    );

    const bars = Array.from(container.querySelectorAll("rect"));

    expect(bars.map((bar): string | null => bar.getAttribute("height"))).toEqual([
      "66",
      "132",
    ]);
    expect(bars.map((bar): string | null => bar.getAttribute("y"))).toEqual([
      "158",
      "26",
    ]);
  });
});
