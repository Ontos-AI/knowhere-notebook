import { cn } from "@/lib/utils"
import * as React from "react"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-[42px] w-full rounded-none border border-slate-500 bg-white px-3 py-2 text-base leading-6 text-slate-950 shadow-none transition-colors file:border-0 file:bg-transparent file:text-base file:font-normal file:text-slate-950 placeholder:text-slate-500 hover:border-slate-600 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-50 disabled:text-slate-400 disabled:placeholder:text-slate-400",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
