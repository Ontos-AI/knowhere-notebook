// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWorkspaceDesktopPanels } from "./workspace-desktop-panels";

describe("useWorkspaceDesktopPanels", () => {
  it("resizes desktop panels from their rendered widths during a drag", () => {
    const { result } = renderHook(() => useWorkspaceDesktopPanels());

    act(() => {
      result.current.handleDesktopPanelElementChange(
        "sources",
        createPanelElement(360),
      );
      result.current.handleDesktopPanelElementChange(
        "chunks",
        createPanelElement(620),
      );
      result.current.handleDesktopPanelResizeStart("sources", "chunks");
      result.current.handleDesktopPanelResize("sources", "chunks", 100);
    });

    expect(result.current.desktopPanelWidths).toEqual({
      sources: 460,
      chunks: 520,
      chat: 420,
    });
  });

  it("falls back to current widths when a panel has not rendered yet", () => {
    const { result } = renderHook(() => useWorkspaceDesktopPanels());

    act(() => {
      result.current.handleDesktopPanelResize("chunks", "chat", -400);
    });

    expect(result.current.desktopPanelWidths).toEqual({
      sources: 350,
      chunks: 480,
      chat: 660,
    });
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
