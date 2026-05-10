"use client"

import { cn } from "@/lib/utils"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import * as React from "react"

type ScrollAreaScrollbarVisibility = "vertical" | "horizontal" | "both"

type ScrollAreaProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> & {
  viewportRef?: React.Ref<HTMLDivElement>
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>
  scrollbars?: ScrollAreaScrollbarVisibility
}

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    {
      className,
      children,
      viewportRef,
      onViewportScroll,
      scrollbars = "vertical",
      ...props
    },
    ref,
  ) => {
    const hasVerticalScrollbar =
      scrollbars === "vertical" || scrollbars === "both"
    const hasHorizontalScrollbar =
      scrollbars === "horizontal" || scrollbars === "both"

    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewportRef}
          className="h-full w-full rounded-[inherit]"
          onScroll={onViewportScroll}
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        {hasVerticalScrollbar ? <ScrollBar orientation="vertical" /> : null}
        {hasHorizontalScrollbar ? <ScrollBar orientation="horizontal" /> : null}
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    )
  },
)
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
