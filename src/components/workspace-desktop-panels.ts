"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { workspaceShellState } from "@/components/workspace-shell-state";

type DesktopPanelKey = keyof typeof workspaceShellState.minimumDesktopPanelWidths;
type DesktopPanelWidths = Record<DesktopPanelKey, number>;
type DesktopSidePanelKey = DesktopPanelKey;

type DesktopPanelResizeDrag = {
  readonly leftPanel: DesktopPanelKey;
  readonly rightPanel: DesktopPanelKey;
  readonly leftWidth: number;
  readonly rightWidth: number;
};

type WorkspaceDesktopPanels = {
  readonly desktopPanelWidths: DesktopPanelWidths;
  readonly minimumDesktopPanelWidth: number;
  readonly handleDesktopLayoutElementChange: (
    element: HTMLDivElement | null,
  ) => void;
  readonly handleDesktopPanelElementChange: (
    panel: DesktopPanelKey,
    element: HTMLDivElement | null,
  ) => void;
  readonly handleDesktopPanelExpand: (panel: DesktopSidePanelKey) => void;
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
  const desktopLayoutResizeObserver = useRef<ResizeObserver | null>(null);
  const desktopPanelElements = useRef<
    Record<DesktopPanelKey, HTMLDivElement | null>
  >({
    sources: null,
    chat: null,
  });
  const desktopPanelResizeDrag = useRef<DesktopPanelResizeDrag | null>(null);

  const fitDesktopPanelWidthsToElement = useCallback(
    (element: HTMLDivElement): void => {
      const renderedWidth = element.getBoundingClientRect().width;
      setDesktopPanelWidths((current) =>
        workspaceShellState.fitDesktopPanelWidthsToContainer(
          renderedWidth,
          current,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    return () => {
      desktopLayoutResizeObserver.current?.disconnect();
    };
  }, []);

  const handleDesktopLayoutElementChange = useCallback(
    (element: HTMLDivElement | null): void => {
      desktopLayoutResizeObserver.current?.disconnect();
      desktopLayoutResizeObserver.current = null;

      if (!element) return;

      fitDesktopPanelWidthsToElement(element);

      if (typeof ResizeObserver === "undefined") return;

      const resizeObserver = new ResizeObserver(() => {
        fitDesktopPanelWidthsToElement(element);
      });
      resizeObserver.observe(element);
      desktopLayoutResizeObserver.current = resizeObserver;
    },
    [fitDesktopPanelWidthsToElement],
  );

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

  function handleDesktopPanelExpand(panel: DesktopSidePanelKey): void {
    setDesktopPanelWidths((current) =>
      workspaceShellState.expandDesktopPanelWidth(current, panel),
    );
  }

  function handleDesktopPanelElementChange(
    panel: DesktopPanelKey,
    element: HTMLDivElement | null,
  ): void {
    desktopPanelElements.current[panel] = element;
  }

  return {
    desktopPanelWidths,
    minimumDesktopPanelWidth:
      workspaceShellState.getMinimumDesktopPanelWidth(desktopPanelWidths),
    handleDesktopLayoutElementChange,
    handleDesktopPanelElementChange,
    handleDesktopPanelExpand,
    handleDesktopPanelResize,
    handleDesktopPanelResizeEnd,
    handleDesktopPanelResizeStart,
  };
}
