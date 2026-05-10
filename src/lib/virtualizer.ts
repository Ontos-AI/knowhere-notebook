import type { Rect, Virtualizer } from "@tanstack/react-virtual";

const fallbackViewportRect = {
  width: 1,
  height: 720,
} as const;

export function observeElementRectWithFallback<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  instance: Virtualizer<TScrollElement, TItemElement>,
  callback: (rect: Rect) => void,
): void | (() => void) {
  const element = instance.scrollElement;
  if (!element) return undefined;

  const notify = (): void => {
    callback({
      width: element.clientWidth || fallbackViewportRect.width,
      height: element.clientHeight || fallbackViewportRect.height,
    });
  };

  notify();

  if (typeof ResizeObserver === "undefined") {
    return undefined;
  }

  const observer = new ResizeObserver(notify);
  observer.observe(element);

  return () => {
    observer.disconnect();
  };
}
