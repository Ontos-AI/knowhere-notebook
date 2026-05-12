import { describe, expect, it } from "vitest";

import { workspaceShellState } from "./workspace-shell-state";

describe("workspaceShellState", () => {
  it("resizes neighboring desktop panels while preserving their combined width", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chunks: 720,
        chat: 420,
      },
      {
        leftPanel: "sources",
        rightPanel: "chunks",
        deltaX: 120,
        leftWidth: 350,
        rightWidth: 600,
      },
    );

    expect(resized).toEqual({
      sources: 470,
      chunks: 480,
      chat: 420,
    });
  });

  it("clamps desktop panel resizing to each panel minimum", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chunks: 720,
        chat: 420,
      },
      {
        leftPanel: "sources",
        rightPanel: "chunks",
        deltaX: -1_000,
        leftWidth: 350,
        rightWidth: 600,
      },
    );

    expect(resized).toEqual({
      sources: workspaceShellState.minimumDesktopPanelWidths.sources,
      chunks: 690,
      chat: 420,
    });
  });
});
