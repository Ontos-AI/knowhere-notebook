"use client";

import { useRef, useState } from "react";

import { workspaceShellState } from "@/components/workspace-shell-state";

type DesktopPanelKey = keyof typeof workspaceShellState.minimumDesktopPanelWidths;
type DesktopPanelWidths = Record<DesktopPanelKey, number>;

type DesktopPanelResizeDrag = {
  readonly leftPanel: DesktopPanelKey;
  readonly rightPanel: DesktopPanelKey;
  readonly leftWidth: number;
  readonly rightWidth: number;
};

type WorkspaceDesktopPanels = {
  readonly desktopPanelWidths: DesktopPanelWidths;
  readonly minimumDesktopPanelWidth: number;
  readonly handleDesktopPanelElementChange: (
    panel: DesktopPanelKey,
    element: HTMLDivElement | null,
  ) => void;
  readonly handleDesktopPanelResize: (
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
    deltaX: number,
  ) => void;
  readonly handleDesktopPanelResizeEnd: () => void;
  readonly handleDesktopPanelResizeStart: (
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
  ) => void;
};

export function useWorkspaceDesktopPanels(): WorkspaceDesktopPanels {
  const [desktopPanelWidths, setDesktopPanelWidths] =
    useState<DesktopPanelWidths>({
      ...workspaceShellState.defaultDesktopPanelWidths,
    });
  const desktopPanelElements = useRef<
    Record<DesktopPanelKey, HTMLDivElement | null>
  >({
    sources: null,
    chunks: null,
    chat: null,
  });
  const desktopPanelResizeDrag = useRef<DesktopPanelResizeDrag | null>(null);

  function getRenderedDesktopPanelWidth(
    panel: DesktopPanelKey,
    fallbackWidth: number,
  ): number {
    const renderedWidth =
      desktopPanelElements.current[panel]?.getBoundingClientRect().width;

    return renderedWidth && Number.isFinite(renderedWidth) && renderedWidth > 0
      ? renderedWidth
      : fallbackWidth;
  }

  function handleDesktopPanelResize(
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
    deltaX: number,
  ): void {
    setDesktopPanelWidths((current) => {
      const drag = desktopPanelResizeDrag.current;
      const leftCurrentWidth =
        drag?.leftPanel === leftPanel && drag.rightPanel === rightPanel
          ? drag.leftWidth
          : getRenderedDesktopPanelWidth(leftPanel, current[leftPanel]);
      const rightCurrentWidth =
        drag?.leftPanel === leftPanel && drag.rightPanel === rightPanel
          ? drag.rightWidth
          : getRenderedDesktopPanelWidth(rightPanel, current[rightPanel]);

      return workspaceShellState.resizeDesktopPanelWidths(current, {
        leftPanel,
        rightPanel,
        deltaX,
        leftWidth: leftCurrentWidth,
        rightWidth: rightCurrentWidth,
      });
    });
  }

  function handleDesktopPanelResizeStart(
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
  ): void {
    desktopPanelResizeDrag.current = {
      leftPanel,
      rightPanel,
      leftWidth: getRenderedDesktopPanelWidth(
        leftPanel,
        desktopPanelWidths[leftPanel],
      ),
      rightWidth: getRenderedDesktopPanelWidth(
        rightPanel,
        desktopPanelWidths[rightPanel],
      ),
    };
  }

  function handleDesktopPanelResizeEnd(): void {
    desktopPanelResizeDrag.current = null;
  }

  function handleDesktopPanelElementChange(
    panel: DesktopPanelKey,
    element: HTMLDivElement | null,
  ): void {
    desktopPanelElements.current[panel] = element;
  }

  return {
    desktopPanelWidths,
    minimumDesktopPanelWidth: workspaceShellState.getMinimumDesktopPanelWidth(),
    handleDesktopPanelElementChange,
    handleDesktopPanelResize,
    handleDesktopPanelResizeEnd,
    handleDesktopPanelResizeStart,
  };
}
