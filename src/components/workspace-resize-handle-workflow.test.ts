// @vitest-environment jsdom
import React, { type ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceResizeHandleWorkflow } from "./workspace-resize-handle-workflow";

describe("useWorkspaceResizeHandleWorkflow", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts desktop resize drag, reports pointer deltas, and cleans up listeners", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const onResizeStart = vi.fn();
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();

    render(
      React.createElement(ResizeHandleWorkflowHarness, {
        onResize,
        onResizeEnd,
        onResizeStart,
      }),
    );

    const pointerDownEvent = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
    });
    screen.getByRole("separator").dispatchEvent(pointerDownEvent);

    expect(pointerDownEvent.defaultPrevented).toBe(true);
    expect(onResizeStart).toHaveBeenCalledOnce();
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
    );
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
    );

    fireEvent(
      window,
      new MouseEvent("pointermove", {
        clientX: 150,
      }),
    );
    expect(onResize).toHaveBeenCalledWith(30);

    fireEvent(window, new MouseEvent("pointerup"));

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
    );
    expect(onResizeEnd).toHaveBeenCalledOnce();
  });
});

function ResizeHandleWorkflowHarness({
  onResize,
  onResizeEnd,
  onResizeStart,
}: {
  readonly onResize: (deltaX: number) => void;
  readonly onResizeEnd: () => void;
  readonly onResizeStart: () => void;
}): ReactElement {
  const { handlePointerDown } = useWorkspaceResizeHandleWorkflow({
    onResize,
    onResizeEnd,
    onResizeStart,
  });

  return React.createElement("button", {
    "aria-label": "resize",
    onPointerDown: handlePointerDown,
    role: "separator",
    type: "button",
  });
}
