"use client"

import DOMPurify from "dompurify"
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react"

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

type MammothConverter = {
  readonly convertToHtml: (input: {
    readonly arrayBuffer: ArrayBuffer
  }) => Promise<{
    readonly value: string
  }>
}

type SourceOriginalDocxWorkflowInput = {
  readonly file: SourceOriginalFileView
}

type SourceOriginalDocxWorkflow = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly status: LoadState<null>
}

export function useSourceOriginalDocxWorkflow({
  file,
}: SourceOriginalDocxWorkflowInput): SourceOriginalDocxWorkflow {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadState, setLoadState] = useState<UrlLoadState<null>>({
    url: file.url,
    state: { status: "loading" },
  })
  const status: LoadState<null> =
    loadState.url === file.url ? loadState.state : { status: "loading" }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const containerElement: HTMLElement = container

    let isCurrent = true
    const controller = new AbortController()
    containerElement.replaceChildren()

    async function renderDocx(): Promise<void> {
      try {
        const [data, module] = await Promise.all([
          sourceOriginalPreviewRequest.getArrayBuffer(
            file.url,
            controller.signal,
          ),
          import("docx-preview"),
        ])
        if (!isCurrent) return
        try {
          await module.renderAsync(data, containerElement, undefined, {
            ignoreFonts: true,
            ignoreWidth: true,
            renderAltChunks: false,
            useBase64URL: true,
          })
        } catch {
          if (!isCurrent) return
          containerElement.replaceChildren()
          await renderDocxHtmlFallback(data, containerElement)
        }
        if (!isCurrent) return
        DOMPurify.sanitize(containerElement, { IN_PLACE: true })
        if (isCurrent) {
          setLoadState({
            url: file.url,
            state: { status: "ready", value: null },
          })
        }
      } catch {
        if (isCurrent) {
          setLoadState({ url: file.url, state: { status: "failed" } })
        }
      }
    }

    void renderDocx()

    return () => {
      isCurrent = false
      controller.abort()
      containerElement.replaceChildren()
    }
  }, [file.url])

  return { containerRef, status }
}

async function renderDocxHtmlFallback(
  data: ArrayBuffer,
  containerElement: HTMLElement,
): Promise<void> {
  const mammothModule = await import("mammoth")
  const converter = getMammothConverter(mammothModule)
  const result = await converter.convertToHtml({ arrayBuffer: data })
  containerElement.innerHTML = DOMPurify.sanitize(result.value)
}

function getMammothConverter(moduleValue: unknown): MammothConverter {
  const moduleRecord = moduleValue as {
    readonly default?: unknown
    readonly convertToHtml?: unknown
  }

  if (isMammothConverter(moduleRecord.default)) {
    return moduleRecord.default
  }
  if (isMammothConverter(moduleRecord)) {
    return moduleRecord
  }

  throw new Error("Mammoth DOCX converter is unavailable.")
}

function isMammothConverter(value: unknown): value is MammothConverter {
  if (typeof value !== "object" || value === null) return false
  return typeof (value as { readonly convertToHtml?: unknown }).convertToHtml === "function"
}
