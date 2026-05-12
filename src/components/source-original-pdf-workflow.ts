"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"

import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model"
import { sourceOriginalPreviewRequest } from "@/components/source-original-preview-request"
import type { SourceOriginalFileView } from "@/domains/sources/types"

type PdfModule = typeof import("react-pdf")
type PdfPageShellRef = (element: HTMLDivElement | null) => void
type PdfFileSource = string | { readonly data: Uint8Array }
type PdfPageLoadSuccess = {
  readonly height: number
}
type PdfPageAspectRatios = ReadonlyMap<number, number>
type PdfDocumentLoadSuccess = {
  readonly numPages: number
  readonly getPage: (pageNumber: number) => Promise<{
    readonly getViewport: (input: { readonly scale: number }) => {
      readonly width: number
      readonly height: number
    }
  }>
}
type UrlValue<T> = {
  readonly url: string
  readonly value: T
}
type PdfFileSourceState =
  | { readonly status: "loading"; readonly url: string }
  | { readonly status: "ready"; readonly url: string; readonly value: PdfFileSource }
  | { readonly status: "failed"; readonly url: string }
type PdfActivePageState = {
  readonly url: string
  readonly value: number | null
}

type SourceOriginalPdfWorkflowInput = {
  readonly file: SourceOriginalFileView
  readonly targetPageNumber?: number | null
  readonly targetPageRequestId?: number
}

type SourceOriginalPdfWorkflow = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly fileSource: PdfFileSource | null
  readonly getPageAspectRatio: (pageNumber: number) => number
  readonly handlePdfLoadSuccess: (document: PdfDocumentLoadSuccess) => void
  readonly handlePdfPageLoadSuccess: (
    pageNumber: number,
    pageWidth: number,
    page: PdfPageLoadSuccess,
  ) => void
  readonly hasPdfFileLoadFailed: boolean
  readonly hasLoadedPageLayout: boolean
  readonly pageCount: number
  readonly pageWidth: number
  readonly pdfModule: PdfModule | null
  readonly registerPageShell: (pageNumber: number) => PdfPageShellRef
  readonly shouldRenderPage: (pageNumber: number) => boolean
}

const pdfPageObserverRootMargin = "600px 0px"
const pdfRenderPagesBefore = 2
const pdfRenderPagesAfter = 20

export function useSourceOriginalPdfWorkflow({
  file,
  targetPageNumber = null,
  targetPageRequestId = 0,
}: SourceOriginalPdfWorkflowInput): SourceOriginalPdfWorkflow {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageShellsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const pageObserverRef = useRef<IntersectionObserver | null>(null)
  const pdfLayoutRequestIdRef = useRef(0)
  const scrolledTargetPageRequestRef = useRef<string | null>(null)
  const [pdfModule, setPdfModule] = useState<PdfModule | null>(null)
  const [fileSourceState, setFileSourceState] = useState<PdfFileSourceState>({
    status: "loading",
    url: file.url,
  })
  const [pageCount, setPageCount] = useState<UrlValue<number>>({
    url: file.url,
    value: 1,
  })
  const [pageWidth, setPageWidth] = useState(
    sourceOriginalPreviewModel.getInitialPdfPageWidth,
  )
  const [pdfPageAspectRatios, setPdfPageAspectRatios] = useState<
    UrlValue<PdfPageAspectRatios>
  >({
    url: file.url,
    value: new Map(),
  })
  const [activePageNumber, setActivePageNumber] = useState<PdfActivePageState>({
    url: file.url,
    value: null,
  })
  const resolvedPageCount = pageCount.url === file.url ? pageCount.value : 1
  const resolvedActivePageNumber =
    activePageNumber.url === file.url ? activePageNumber.value : null
  const fileSource =
    fileSourceState.url === file.url && fileSourceState.status === "ready"
      ? fileSourceState.value
      : null
  const hasPdfFileLoadFailed =
    fileSourceState.url === file.url && fileSourceState.status === "failed"
  const resolvedPageAspectRatios = useMemo(
    () =>
      pdfPageAspectRatios.url === file.url
        ? pdfPageAspectRatios.value
        : new Map(),
    [file.url, pdfPageAspectRatios],
  )
  const hasLoadedPageLayout =
    resolvedPageAspectRatios.size >= resolvedPageCount

  const handlePdfLoadSuccess = useCallback(
    (document: PdfDocumentLoadSuccess): void => {
      const { numPages } = document
      const requestId = pdfLayoutRequestIdRef.current + 1
      pdfLayoutRequestIdRef.current = requestId
      setPageCount({ url: file.url, value: numPages })
      setPdfPageAspectRatios({ url: file.url, value: new Map() })

      void loadPdfPageAspectRatios(
        document,
        numPages,
        () => pdfLayoutRequestIdRef.current === requestId,
      ).then((aspectRatios) => {
        if (pdfLayoutRequestIdRef.current !== requestId) return
        setPdfPageAspectRatios({ url: file.url, value: aspectRatios })
      })
    },
    [file.url],
  )

  const handlePageIntersections = useCallback(
    (entries: IntersectionObserverEntry[]): void => {
      const nextActivePageNumber = getActivePageNumberFromIntersections(entries)
      if (nextActivePageNumber === null) return

      setActivePageNumber((previous) => {
        if (
          previous.url === file.url &&
          previous.value === nextActivePageNumber
        ) {
          return previous
        }

        return {
          url: file.url,
          value: nextActivePageNumber,
        }
      })
    },
    [file.url],
  )

  const handlePdfPageLoadSuccess = useCallback(
    (
      pageNumber: number,
      loadedPageWidth: number,
      page: PdfPageLoadSuccess,
    ): void => {
      setPdfPageAspectRatios((previousState) => {
        const nextAspectRatio = page.height / loadedPageWidth
        const previousAspectRatio = previousState.value.get(pageNumber)
        if (
          previousState.url === file.url &&
          previousAspectRatio === nextAspectRatio
        ) {
          return previousState
        }

        const next =
          previousState.url === file.url
            ? new Map(previousState.value)
            : new Map<number, number>()
        next.set(pageNumber, nextAspectRatio)
        return { url: file.url, value: next }
      })
    },
    [file.url],
  )

  const getPageAspectRatio = useCallback(
    (pageNumber: number): number =>
      sourceOriginalPreviewModel.getPdfPageAspectRatio(
        resolvedPageAspectRatios,
        pageNumber,
      ),
    [resolvedPageAspectRatios],
  )

  const shouldRenderPage = useCallback(
    (pageNumber: number): boolean =>
      typeof IntersectionObserver === "undefined" ||
      shouldRenderPdfPage(
        pageNumber,
        resolvedActivePageNumber,
        targetPageNumber,
        resolvedPageCount,
      ),
    [resolvedActivePageNumber, resolvedPageCount, targetPageNumber],
  )

  const scrollToTargetPageIfNeeded = useCallback(
    (pageNumber: number, element: HTMLDivElement): void => {
      if (targetPageNumber !== pageNumber) return

      const requestKey = [
        file.url,
        targetPageNumber,
        targetPageRequestId,
      ].join(":")
      if (scrolledTargetPageRequestRef.current === requestKey) return

      scrolledTargetPageRequestRef.current = requestKey
      requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    },
    [file.url, targetPageNumber, targetPageRequestId],
  )

  const registerPageShell = useCallback(
    (pageNumber: number): PdfPageShellRef =>
      (element) => {
        if (element) {
          pageShellsRef.current.set(pageNumber, element)
          pageObserverRef.current?.observe(element)
          scrollToTargetPageIfNeeded(pageNumber, element)
        } else {
          const previousElement = pageShellsRef.current.get(pageNumber)
          if (previousElement) {
            pageObserverRef.current?.unobserve(previousElement)
          }
          pageShellsRef.current.delete(pageNumber)
        }
      },
    [scrollToTargetPageIfNeeded],
  )

  useEffect(() => {
    let isCurrent = true

    void import("react-pdf").then((module) => {
      module.pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString()
      if (isCurrent) setPdfModule(module)
    })

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    const controller = new AbortController()

    async function loadPdfFileSource(): Promise<void> {
      try {
        const data = await sourceOriginalPreviewRequest.getArrayBuffer(
          file.url,
          controller.signal,
        )
        if (!isCurrent) return

        setFileSourceState({
          status: "ready",
          url: file.url,
          value: { data: new Uint8Array(data) },
        })
      } catch {
        if (isCurrent) setFileSourceState({ status: "failed", url: file.url })
      }
    }

    void loadPdfFileSource()

    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [file.url])

  useEffect(() => {
    return () => {
      pdfLayoutRequestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updatePageWidth = (): void => {
      setPageWidth(
        sourceOriginalPreviewModel.getPdfPageWidth(container.clientWidth),
      )
    }

    const observer = new ResizeObserver(updatePageWidth)
    updatePageWidth()
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [pdfModule])

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return

    const container = containerRef.current
    const observer = new IntersectionObserver(handlePageIntersections, {
      root: container ? getPdfPageObserverRoot(container) : null,
      rootMargin: pdfPageObserverRootMargin,
    })
    pageObserverRef.current = observer

    for (const shell of pageShellsRef.current.values()) {
      observer.observe(shell)
    }

    return () => {
      pageObserverRef.current = null
      observer.disconnect()
    }
  }, [handlePageIntersections])

  useEffect(() => {
    if (!targetPageNumber) return

    const element = pageShellsRef.current.get(targetPageNumber)
    if (element) scrollToTargetPageIfNeeded(targetPageNumber, element)
  }, [scrollToTargetPageIfNeeded, targetPageNumber, targetPageRequestId])

  return {
    containerRef,
    fileSource,
    getPageAspectRatio,
    handlePdfLoadSuccess,
    handlePdfPageLoadSuccess,
    hasPdfFileLoadFailed,
    hasLoadedPageLayout,
    pageCount: resolvedPageCount,
    pageWidth,
    pdfModule,
    registerPageShell,
    shouldRenderPage,
  }
}

function shouldRenderPdfPage(
  pageNumber: number,
  activePageNumber: number | null,
  targetPageNumber: number | null,
  pageCount: number,
): boolean {
  const anchorPageNumber = getPdfRenderAnchorPageNumber(
    activePageNumber,
    targetPageNumber,
    pageCount,
  )
  const firstRenderPage = Math.max(1, anchorPageNumber - pdfRenderPagesBefore)
  const lastRenderPage = Math.min(pageCount, anchorPageNumber + pdfRenderPagesAfter)

  return pageNumber >= firstRenderPage && pageNumber <= lastRenderPage
}

function getPdfRenderAnchorPageNumber(
  activePageNumber: number | null,
  targetPageNumber: number | null,
  pageCount: number,
): number {
  const candidate = activePageNumber ?? targetPageNumber ?? 1
  if (!Number.isFinite(candidate)) return 1
  return Math.min(Math.max(1, candidate), Math.max(1, pageCount))
}

function getActivePageNumberFromIntersections(
  entries: readonly IntersectionObserverEntry[],
): number | null {
  let selectedPageNumber: number | null = null
  let selectedDistance: number | null = null

  entries.forEach((entry) => {
    if (!entry.isIntersecting) return

    const pageNumber = getPdfPageShellNumber(entry.target)
    if (pageNumber === null) return

    const distance = getIntersectionTopDistance(entry)
    if (distance === null) {
      selectedPageNumber = pageNumber
      selectedDistance = null
      return
    }
    if (
      selectedDistance === null ||
      distance <= selectedDistance
    ) {
      selectedPageNumber = pageNumber
      selectedDistance = distance
    }
  })

  return selectedPageNumber
}

function getPdfPageShellNumber(target: Element): number | null {
  const pageNumber = Number((target as HTMLElement).dataset.pdfPageShell)
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null
  return pageNumber
}

function getIntersectionTopDistance(
  entry: IntersectionObserverEntry,
): number | null {
  const top = entry.boundingClientRect?.top
  if (typeof top !== "number" || !Number.isFinite(top)) return null

  const rootTop = entry.rootBounds?.top ?? 0
  return Math.abs(top - rootTop)
}

function getPdfPageObserverRoot(
  container: HTMLDivElement,
): Element | Document | null {
  return container.closest("[data-radix-scroll-area-viewport]") ?? container
}

async function loadPdfPageAspectRatios(
  document: PdfDocumentLoadSuccess,
  pageCount: number,
  shouldContinue: () => boolean,
): Promise<PdfPageAspectRatios> {
  const aspectRatios = new Map<number, number>()

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (!shouldContinue()) return aspectRatios

    try {
      const page = await document.getPage(pageNumber)
      if (!shouldContinue()) return aspectRatios
      const viewport = page.getViewport({ scale: 1 })
      aspectRatios.set(
        pageNumber,
        sourceOriginalPreviewModel.getSafePdfPageAspectRatio(
          viewport.width,
          viewport.height,
        ),
      )
    } catch {
      aspectRatios.set(
        pageNumber,
        sourceOriginalPreviewModel.pdfPageAspectRatio,
      )
    }
  }

  return aspectRatios
}
