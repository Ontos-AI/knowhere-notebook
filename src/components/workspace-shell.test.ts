// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DESKTOP_PANEL_GUTTER_WIDTH,
  DESKTOP_PANEL_MIN_WIDTHS,
  WorkspaceShell,
} from "./workspace-shell";

const C = WorkspaceShell as React.FC<Record<string, unknown>>;

describe("WorkspaceShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps desktop panels horizontally scrollable at their minimum widths", () => {
    render(React.createElement(C, { sources: [] }));

    const layout = screen.getByTestId("desktop-panel-layout");
    const panels = screen.getByTestId("desktop-resizable-panels");
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");

    const minimumTotalWidth =
      DESKTOP_PANEL_MIN_WIDTHS.sources +
      DESKTOP_PANEL_MIN_WIDTHS.chunks +
      DESKTOP_PANEL_MIN_WIDTHS.chat +
      DESKTOP_PANEL_GUTTER_WIDTH * 2;

    expect(layout.className).toContain("overflow-x-auto");
    expect(panels.style.minWidth).toBe(`${minimumTotalWidth}px`);
    expect(chunksPanel.style.minWidth).toBe(
      `${DESKTOP_PANEL_MIN_WIDTHS.chunks}px`,
    );
  });

  it("lets desktop users resize neighboring panels without folding below minimum widths", () => {
    render(React.createElement(C, { sources: [] }));

    const firstHandle = screen.getByRole("separator", {
      name: "Resize sources and parsed chunks",
    });
    const sourcesPanel = screen.getByTestId("desktop-sources-panel");
    const chunksPanel = screen.getByTestId("desktop-chunks-panel");

    fireEvent.pointerDown(firstHandle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 120 });
    fireEvent.pointerUp(window);

    expect(sourcesPanel.style.width).toBe("440px");
    expect(chunksPanel.style.width).toBe("600px");

    fireEvent.pointerDown(firstHandle, { clientX: 120 });
    fireEvent.pointerMove(window, { clientX: -1000 });
    fireEvent.pointerUp(window);

    expect(sourcesPanel.style.width).toBe(
      `${DESKTOP_PANEL_MIN_WIDTHS.sources}px`,
    );
  });
});
