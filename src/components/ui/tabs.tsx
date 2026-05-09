"use client"

import { cn } from "@/lib/utils"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

const Tabs = TabsPrimitive.Root

const tabsListVariants = cva("inline-flex items-center justify-center", {
  variants: {
    variant: {
      default: "h-10 rounded-xl bg-secondary/80 p-1 text-muted-foreground shadow-xs",
      page: "h-auto gap-0 rounded-none bg-transparent p-0 text-muted-foreground",
      code: "h-auto gap-3 rounded-none bg-transparent p-0",
      model: "h-auto items-end gap-0 rounded-none bg-transparent p-0",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "rounded-lg px-3 py-2 text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs",
        page: "h-[63px] rounded-none border-b-[6px] border-transparent px-4 py-[10px] text-sm font-light text-zinc-950 data-[state=active]:border-zinc-200 data-[state=active]:bg-zinc-100 data-[state=active]:font-semibold data-[state=active]:shadow-none",
        code: "rounded-none bg-zinc-700 px-3 py-2 font-mono text-sm text-zinc-50 data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 data-[state=active]:shadow-none",
        model:
          "h-[36px] items-center rounded-none bg-[#FEE685] px-4 py-2 font-mono-display text-sm font-light text-[#461901] hover:bg-[#FFD230] hover:shadow-[inset_0_-4px_0_0_#FFBA00] active:bg-[#FFBA00] active:shadow-[inset_0_-4px_0_0_#FD9A00] data-[state=active]:bg-[#FD9A00] data-[state=active]:font-bold data-[state=active]:text-white data-[state=active]:shadow-[inset_0_-4px_0_0_#E17100]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>
>(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(tabsListVariants({ variant }), className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> &
    VariantProps<typeof tabsTriggerVariants>
>(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(tabsTriggerVariants({ variant }), className)}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
