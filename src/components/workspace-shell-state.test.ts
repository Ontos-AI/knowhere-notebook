import { describe, expect, it } from "vitest";

import { workspaceShellState } from "./workspace-shell-state";

describe("workspaceShellState", () => {
  it("fits default desktop panel widths inside a 13-inch viewport", () => {
    const widths = workspaceShellState.fitDesktopPanelWidthsToContainer(1280);
    const totalWidth =
      widths.sources +
      widths.chat +
      workspaceShellState.desktopPanelGutterWidth;

    expect(totalWidth).toBeLessThanOrEqual(1280);
    expect(widths.sources).toBeGreaterThanOrEqual(
      workspaceShellState.minimumDesktopPanelWidths.sources,
    );
    expect(widths.chat).toBeGreaterThanOrEqual(
      workspaceShellState.minimumDesktopPanelWidths.chat,
    );
  });

  it("resizes neighboring desktop panels while preserving their combined width", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chat: 800,
      },
      {
        leftPanel: "sources",
        rightPanel: "chat",
        deltaX: 120,
        leftWidth: 350,
        rightWidth: 800,
      },
    );

    expect(resized).toEqual({
      sources: 470,
      chat: 680,
    });
  });

  it("allows the sources panel to narrow continuously before sidebar mode", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chat: 800,
      },
      {
        leftPanel: "sources",
        rightPanel: "chat",
        deltaX: -170,
        leftWidth: 350,
        rightWidth: 800,
      },
    );

    expect(resized).toEqual({
      sources: 180,
      chat: 970,
    });
  });

  it("clamps the sources panel at the compact sidebar width", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chat: 800,
      },
      {
        leftPanel: "sources",
        rightPanel: "chat",
        deltaX: -400,
        leftWidth: 350,
        rightWidth: 800,
      },
    );

    expect(resized.sources).toBe(
      workspaceShellState.collapsedDesktopPanelWidth,
    );
    expect(resized.sources + resized.chat).toBe(1150);
  });

  it("clamps the chat panel at the compact sidebar width", () => {
    const resized = workspaceShellState.resizeDesktopPanelWidths(
      {
        sources: 350,
        chat: 800,
      },
      {
        leftPanel: "sources",
        rightPanel: "chat",
        deltaX: 1200,
        leftWidth: 350,
        rightWidth: 800,
      },
    );

    expect(resized.chat).toBe(
      workspaceShellState.collapsedDesktopPanelWidth,
    );
    expect(resized.sources + resized.chat).toBe(1150);
  });

  it("includes compact sidebars when calculating the minimum desktop width", () => {
    const minimumWidth = workspaceShellState.getMinimumDesktopPanelWidth({
      sources: workspaceShellState.collapsedDesktopPanelWidth,
      chat: workspaceShellState.collapsedDesktopPanelWidth,
    });

    expect(minimumWidth).toBe(
      workspaceShellState.collapsedDesktopPanelWidth * 2 +
        workspaceShellState.desktopPanelGutterWidth,
    );
  });
});
