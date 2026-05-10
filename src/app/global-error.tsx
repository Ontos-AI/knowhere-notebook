"use client"

import { RotateCcw } from "lucide-react"

import "./globals.css"

type GlobalErrorProps = {
  error: Error & { digest?: string }
  unstable_retry: () => void
}

export default function GlobalError({
  unstable_retry,
}: GlobalErrorProps) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong - Knowhere Notebook</title>
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 font-sans text-foreground antialiased">
          <div className="w-full max-w-md text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Notebook error
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal">
              Something went wrong
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The notebook could not load correctly. Try again, or refresh the
              page if the problem continues.
            </p>
            <button
              type="button"
              className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/80 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15"
              onClick={() => unstable_retry()}
            >
              <RotateCcw className="size-4" />
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
