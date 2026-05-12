"use client"

import { useEffect, useState } from "react"

import { sourceOriginalPreviewRequest } from "@/components/source-original-preview-request"
import type { SourceOriginalFileView } from "@/domains/sources/types"

type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed" }

type UrlLoadState<T> = {
  readonly url: string
  readonly state: LoadState<T>
}

type SourceOriginalTextWorkflowInput = {
  readonly file: SourceOriginalFileView
}

export function useSourceOriginalTextWorkflow({
  file,
}: SourceOriginalTextWorkflowInput): LoadState<string> {
  const [loadState, setLoadState] = useState<UrlLoadState<string>>({
    url: file.url,
    state: { status: "loading" },
  })

  useEffect(() => {
    let isCurrent = true
    const controller = new AbortController()

    async function loadText(): Promise<void> {
      try {
        const value = await sourceOriginalPreviewRequest.getText(
          file.url,
          controller.signal,
        )
        if (isCurrent) {
          setLoadState({ url: file.url, state: { status: "ready", value } })
        }
      } catch {
        if (isCurrent) {
          setLoadState({ url: file.url, state: { status: "failed" } })
        }
      }
    }

    void loadText()

    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [file.url])

  return loadState.url === file.url ? loadState.state : { status: "loading" }
}
