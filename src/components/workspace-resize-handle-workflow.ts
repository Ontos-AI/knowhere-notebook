"use client";

import type {
  PointerEvent as ReactPointerEvent,
} from "react";

type WorkspaceResizeHandleWorkflowInput = {
  readonly onResize: (deltaX: number) => void;
  readonly onResizeEnd?: () => void;
  readonly onResizeStart?: () => void;
};

type WorkspaceResizeHandleWorkflow = {
  readonly handlePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
};

export function useWorkspaceResizeHandleWorkflow({
  onResize,
  onResizeEnd,
  onResizeStart,
}: WorkspaceResizeHandleWorkflowInput): WorkspaceResizeHandleWorkflow {
  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault();
    const startClientX = event.clientX;
    onResizeStart?.();

    function handlePointerMove(moveEvent: PointerEvent): void {
      onResize(moveEvent.clientX - startClientX);
    }

    function handlePointerUp(): void {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      onResizeEnd?.();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return { handlePointerDown };
}
