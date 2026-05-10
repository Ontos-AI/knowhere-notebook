"use client"

import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

type ErrorPageProps = {
  error: Error & { digest?: string }
  unstable_retry: () => void
}

export default function ErrorPage({
  unstable_retry,
}: ErrorPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Notebook error
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-normal">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The notebook could not finish this request. Try again, or refresh the
          page if the problem continues.
        </p>
        <Button
          type="button"
          className="mt-6 inline-flex items-center gap-2"
          onClick={() => unstable_retry()}
        >
          <RotateCcw className="size-4" />
          Try again
        </Button>
      </div>
    </main>
  )
}
