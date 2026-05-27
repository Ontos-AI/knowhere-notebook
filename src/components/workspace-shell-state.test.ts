import { describe, expect, it } from "vitest";

import { workspaceShellState } from "./workspace-shell-state";

describe("workspaceShellState", () => {
  it("fits default desktop panel widths inside a 13-inch viewport", () => {
    const widths = workspaceShellState.fitDesktopPanelWidthsToContainer(1280);
    const totalWidth =
      widths.sources +
      widths.chunks +
      widths.chat +
      workspaceShellState.desktopPanelGutterWidth * 2;

    expect(totalWidth).toBeLessThanOrEqual(1280);
    expect(widths.sources).toBeGreaterThanOrEqual(
      workspaceShellState.minimumDesktopPanelWidths.sources,
    );
    expect(widths.chunks).toBeGreaterThanOrEqual(
      workspaceShellState.minimumDesktopPanelWidths.chunks,
    );
    expect(widths.chat).toBeGreaterThanOrEqual(
      workspaceShellState.minimumDesktopPanelWidths.chat,
    );
  });

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

  it("allows the sources panel to narrow continuously before sidebar mode", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chunks: 720,
        chat: 420,
      },
      {
        leftPanel: "sources",
        rightPanel: "chunks",
        deltaX: -170,
        leftWidth: 350,
        rightWidth: 600,
      },
    );

    expect(resized).toEqual({
      sources: 180,
      chunks: 770,
      chat: 420,
    });
  });

  it("allows the chat panel to narrow continuously before sidebar mode", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chunks: 720,
        chat: 420,
      },
      {
        leftPanel: "chunks",
        rightPanel: "chat",
        deltaX: 240,
        leftWidth: 650,
        rightWidth: 420,
      },
    );

    expect(resized).toEqual({
      sources: 350,
      chunks: 890,
      chat: 180,
    });
  });

  it("clamps the sources panel at the compact sidebar width", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chunks: 720,
        chat: 420,
      },
      {
        leftPanel: "sources",
        rightPanel: "chunks",
        deltaX: -300,
        leftWidth: 350,
        rightWidth: 600,
      },
    );

    expect(resized).toEqual({
      sources: workspaceShellState.collapsedDesktopPanelWidth,
      chunks: 950 - workspaceShellState.collapsedDesktopPanelWidth,
      chat: 420,
    });
  });

  it("clamps the chat panel at the compact sidebar width", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chunks: 720,
        chat: 420,
      },
      {
        leftPanel: "chunks",
        rightPanel: "chat",
        deltaX: 400,
        leftWidth: 650,
        rightWidth: 420,
      },
    );

    expect(resized).toEqual({
      sources: 350,
      chunks: 1_070 - workspaceShellState.collapsedDesktopPanelWidth,
      chat: workspaceShellState.collapsedDesktopPanelWidth,
    });
  });

  it("includes compact sidebars when calculating the minimum desktop width", () => {
    const minimumWidth = workspaceShellState.getMinimumDesktopPanelWidth({
      sources: workspaceShellState.collapsedDesktopPanelWidth,
      chunks: 900,
      chat: workspaceShellState.collapsedDesktopPanelWidth,
    });

    expect(minimumWidth).toBe(
      workspaceShellState.collapsedDesktopPanelWidth * 2 +
        workspaceShellState.minimumDesktopPanelWidths.chunks +
        workspaceShellState.desktopPanelGutterWidth * 2,
    );
  });
});
