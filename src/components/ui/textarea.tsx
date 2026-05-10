import { cn } from "@/lib/utils"
import * as React from "react"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[96px] w-full rounded-none border border-slate-500 bg-white px-3 py-2 text-base leading-6 text-slate-950 shadow-none placeholder:text-slate-500 transition-colors hover:border-slate-600 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-50 disabled:text-slate-400 disabled:placeholder:text-slate-400",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
