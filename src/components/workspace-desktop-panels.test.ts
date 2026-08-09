// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWorkspaceDesktopPanels } from "./workspace-desktop-panels";
import { workspaceShellState } from "./workspace-shell-state";

describe("useWorkspaceDesktopPanels", () => {
  it("fits default desktop panel widths to the rendered layout width", () => {
    const { result } = renderHook(() => useWorkspaceDesktopPanels());

    act(() => {
      result.current.handleDesktopLayoutElementChange(createPanelElement(1280));
    });

    const totalWidth =
      result.current.desktopPanelWidths.sources +
      result.current.desktopPanelWidths.chat +
      workspaceShellState.desktopPanelGutterWidth;

    expect(totalWidth).toBeLessThanOrEqual(1280);
    expect(result.current.desktopPanelWidths.sources).toBeGreaterThanOrEqual(
      workspaceShellState.collapsedDesktopPanelWidth,
    );
    expect(result.current.desktopPanelWidths.chat).toBeGreaterThan(0);
  });

  it("resizes desktop panels from their rendered widths during a drag", () => {
    const { result } = renderHook(() => useWorkspaceDesktopPanels());

    act(() => {
      result.current.handleDesktopPanelElementChange(
        "sources",
        createPanelElement(360),
      );
      result.current.handleDesktopPanelElementChange(
        "chat",
        createPanelElement(800),
      );
      result.current.handleDesktopPanelResizeStart("sources", "chat");
      result.current.handleDesktopPanelResize("sources", "chat", 100);
    });

    expect(result.current.desktopPanelWidths.sources).toBe(460);
    expect(result.current.desktopPanelWidths.chat).toBe(700);
  });

  it("falls back to current widths when a panel has not rendered yet", () => {
    const { result } = renderHook(() => useWorkspaceDesktopPanels());

    act(() => {
      result.current.handleDesktopPanelResize("sources", "chat", -400);
    });

    expect(result.current.desktopPanelWidths.sources).toBeGreaterThanOrEqual(
      workspaceShellState.collapsedDesktopPanelWidth,
    );
    expect(result.current.desktopPanelWidths.chat).toBeGreaterThan(0);
  });
});

function createPanelElement(width: number): HTMLDivElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({
      width,
    }) as DOMRect;

  return element;
}
