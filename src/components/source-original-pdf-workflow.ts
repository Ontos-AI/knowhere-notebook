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
import type { SourceOriginalFileView } from "@/domains/sources/types"

type PdfModule = typeof import("react-pdf")
type PdfPageShellRef = (element: HTMLDivElement | null) => void
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

type SourceOriginalPdfWorkflowInput = {
  readonly file: SourceOriginalFileView
}

type SourceOriginalPdfWorkflow = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly getPageAspectRatio: (pageNumber: number) => number
  readonly handlePdfLoadSuccess: (document: PdfDocumentLoadSuccess) => void
  readonly handlePdfPageLoadSuccess: (
    pageNumber: number,
    pageWidth: number,
    page: PdfPageLoadSuccess,
  ) => void
  readonly hasLoadedPageLayout: boolean
  readonly pageCount: number
  readonly pageWidth: number
  readonly pdfModule: PdfModule | null
  readonly registerPageShell: (pageNumber: number) => PdfPageShellRef
  readonly shouldRenderPage: (pageNumber: number) => boolean
}

const pdfPageObserverRootMargin = "600px 0px"

export function useSourceOriginalPdfWorkflow({
  file,
}: SourceOriginalPdfWorkflowInput): SourceOriginalPdfWorkflow {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageShellsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const pageObserverRef = useRef<IntersectionObserver | null>(null)
  const pdfLayoutRequestIdRef = useRef(0)
  const [pdfModule, setPdfModule] = useState<PdfModule | null>(null)
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
  const [visiblePageNumbers, setVisiblePageNumbers] = useState<ReadonlySet<number>>(
    () => new Set(),
  )
  const resolvedPageCount = pageCount.url === file.url ? pageCount.value : 1
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
      setVisiblePageNumbers((previous) => {
        let next: Set<number> | null = null

        for (const entry of entries) {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pdfPageShell,
          )
          if (!Number.isInteger(pageNumber)) continue

          const isVisible = entry.isIntersecting
          if (previous.has(pageNumber) === isVisible) continue

          next ??= new Set(previous)
          if (isVisible) {
            next.add(pageNumber)
          } else {
            next.delete(pageNumber)
          }
        }

        return next ?? previous
      })
    },
    [],
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
      visiblePageNumbers.has(pageNumber),
    [visiblePageNumbers],
  )

  const registerPageShell = useCallback(
    (pageNumber: number): PdfPageShellRef =>
      (element) => {
        if (element) {
          pageShellsRef.current.set(pageNumber, element)
          pageObserverRef.current?.observe(element)
        } else {
          const previousElement = pageShellsRef.current.get(pageNumber)
          if (previousElement) {
            pageObserverRef.current?.unobserve(previousElement)
          }
          pageShellsRef.current.delete(pageNumber)
        }
      },
    [],
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

    const observer = new IntersectionObserver(handlePageIntersections, {
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

  return {
    containerRef,
    getPageAspectRatio,
    handlePdfLoadSuccess,
    handlePdfPageLoadSuccess,
    hasLoadedPageLayout,
    pageCount: resolvedPageCount,
    pageWidth,
    pdfModule,
    registerPageShell,
    shouldRenderPage,
  }
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
