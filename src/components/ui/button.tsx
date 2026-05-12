import { cn } from "@/lib/utils"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent tracking-normal transition-[color,background-color,border-color,padding-bottom,box-shadow,transform] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "text-[#F5F3FF] shadow-none",
        destructive:
          "rounded-lg bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 hover:shadow-sm",
        outline:
          "rounded-lg border border-border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary: "border-stone-200 text-stone-800 shadow-none",
        ghost: "rounded-lg hover:bg-accent hover:text-accent-foreground",
        link: "rounded-none border-none p-0 text-primary underline-offset-4 hover:underline",
        "pill-primary": "text-[#F5F3FF] shadow-none",
        "pill-secondary": "border-stone-200 text-stone-800 shadow-none",
        mono: "bg-zinc-800 font-mono text-primary-light shadow-none hover:bg-zinc-700",
        "copy-cli":
          "bg-zinc-800 font-normal text-[#A684FF] shadow-none hover:bg-zinc-900 hover:font-semibold active:bg-zinc-950 active:font-semibold",
        "copy-code":
          "bg-zinc-800 font-mono-readable font-normal text-[#A684FF] shadow-none hover:bg-zinc-700 hover:text-[#C4B4FF] active:bg-zinc-600 active:text-[#DDD6FF]",
      },
      size: {
        default: "h-16 px-7 pb-1 text-base [&_svg]:size-5",
        sm: "h-10 rounded-lg px-4 py-2 text-sm [&_svg]:size-4",
        lg: "h-[72px] px-9 pb-1 text-xl [&_svg]:size-6",
        icon: "size-10",
        "pill-md": "h-16 px-7 pb-1 text-base [&_svg]:size-5",
        "pill-lg": "h-[72px] px-9 pb-1 text-xl [&_svg]:size-6",
        "copy-cli": "h-9 w-[72px] px-0 py-2 text-sm",
        "copy-code": "h-9 px-4 py-2 text-sm",
      },
    },
    compoundVariants: [
      {
        variant: "default",
        size: "sm",
        class:
          "border-[#7F22FE] border-b-[4px] bg-[#8E51FF] font-mono-readable font-semibold hover:border-[#7008E7] hover:border-b-[5px] hover:bg-[#7F22FE] active:border-[#7008E7] active:border-b-[4px] active:bg-[#7008E7] active:pb-1 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "default",
        size: ["default", "pill-md"],
        class:
          "border-[#7F22FE] border-b-[6px] bg-[#8E51FF] font-mono-readable font-semibold hover:border-[#7008E7] hover:border-b-[8px] hover:bg-[#7F22FE] active:border-[#7008E7] active:border-b-[6px] active:bg-[#7008E7] active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "default",
        size: ["lg", "pill-lg"],
        class:
          "border-[#7F22FE] border-b-[6px] bg-[#8E51FF] font-mono-display font-semibold hover:border-[#7008E7] hover:border-b-[8px] hover:bg-[#7F22FE] active:border-[#7008E7] active:border-b-[6px] active:bg-[#7008E7] active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "secondary",
        size: ["default", "pill-md"],
        class:
          "border-x-2 border-t-2 border-b-[6px] bg-stone-50 font-mono-readable font-semibold hover:border-b-[8px] hover:bg-stone-100 active:border-b-[6px] active:bg-stone-200 active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "secondary",
        size: ["lg", "pill-lg"],
        class:
          "border-x-2 border-t-2 border-b-[6px] bg-stone-50 font-mono-display font-semibold hover:border-b-[8px] hover:bg-stone-100 active:border-b-[6px] active:bg-stone-200 active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "pill-primary",
        size: ["default", "pill-md"],
        class:
          "border-[#7F22FE] border-b-[6px] bg-[#8E51FF] font-mono-readable font-semibold hover:border-[#7008E7] hover:border-b-[8px] hover:bg-[#7F22FE] active:border-[#7008E7] active:border-b-[6px] active:bg-[#7008E7] active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "pill-primary",
        size: ["lg", "pill-lg"],
        class:
          "border-[#7F22FE] border-b-[6px] bg-[#8E51FF] font-mono-display font-semibold hover:border-[#7008E7] hover:border-b-[8px] hover:bg-[#7F22FE] active:border-[#7008E7] active:border-b-[6px] active:bg-[#7008E7] active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "pill-secondary",
        size: ["default", "pill-md"],
        class:
          "border-x-2 border-t-2 border-b-[6px] bg-stone-50 font-mono-readable font-semibold hover:border-b-[8px] hover:bg-stone-100 active:border-b-[6px] active:bg-stone-200 active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
      {
        variant: "pill-secondary",
        size: ["lg", "pill-lg"],
        class:
          "border-x-2 border-t-2 border-b-[6px] bg-stone-50 font-mono-display font-semibold hover:border-b-[8px] hover:bg-stone-100 active:border-b-[6px] active:bg-stone-200 active:pb-0 disabled:border-stone-200 disabled:bg-stone-300 disabled:text-stone-400",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
