"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileText, Loader2 } from "lucide-react";

import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import type { SourceOriginalFileView } from "@/domains/sources/types";

type PdfPageComponent = typeof import("react-pdf")["Page"];
type PdfPageShellRef = (element: HTMLDivElement | null) => void;
type PdfPageLoadSuccess = {
  readonly height: number;
};
type PdfPageAspectRatios = ReadonlyMap<number, number>;
type PdfDocumentLoadSuccess = {
  readonly numPages: number;
  readonly getPage: (pageNumber: number) => Promise<{
    readonly getViewport: (input: { readonly scale: number }) => {
      readonly width: number;
      readonly height: number;
    };
  }>;
};
type LazyPdfPageProps = {
  readonly PageComponent: PdfPageComponent;
  readonly pageNumber: number;
  readonly pageCount: number;
  readonly width: number;
  readonly aspectRatio: number;
  readonly shouldRender: boolean;
  readonly pageShellRef: PdfPageShellRef;
  readonly onPageLoadSuccess: (
    pageNumber: number,
    pageWidth: number,
    page: PdfPageLoadSuccess,
  ) => void;
};
type UrlValue<T> = {
  readonly url: string;
  readonly value: T;
};

const pdfCanvasDevicePixelRatio = 2;
const pdfPageObserverRootMargin = "600px 0px";

export function SourceOriginalPdfPreview({
  file,
}: {
  readonly file: SourceOriginalFileView;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageShellsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageObserverRef = useRef<IntersectionObserver | null>(null);
  const pdfLayoutRequestIdRef = useRef(0);
  const [pdfModule, setPdfModule] =
    useState<typeof import("react-pdf") | null>(null);
  const [pageCount, setPageCount] = useState<UrlValue<number>>({
    url: file.url,
    value: 1,
  });
  const [pageWidth, setPageWidth] = useState(
    sourceOriginalPreviewModel.getInitialPdfPageWidth,
  );
  const [pdfPageAspectRatios, setPdfPageAspectRatios] = useState<
    UrlValue<PdfPageAspectRatios>
  >({
    url: file.url,
    value: new Map(),
  });
  const [visiblePageNumbers, setVisiblePageNumbers] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const resolvedPageCount = pageCount.url === file.url ? pageCount.value : 1;
  const resolvedPageAspectRatios =
    pdfPageAspectRatios.url === file.url
      ? pdfPageAspectRatios.value
      : new Map();
  const hasLoadedPageLayout =
    resolvedPageAspectRatios.size >= resolvedPageCount;
  const handlePdfLoadSuccess = useCallback(
    (document: PdfDocumentLoadSuccess) => {
      const { numPages } = document;
      const requestId = pdfLayoutRequestIdRef.current + 1;
      pdfLayoutRequestIdRef.current = requestId;
      setPageCount({ url: file.url, value: numPages });
      setPdfPageAspectRatios({ url: file.url, value: new Map() });

      void loadPdfPageAspectRatios(
        document,
        numPages,
        () => pdfLayoutRequestIdRef.current === requestId,
      ).then((aspectRatios) => {
        if (pdfLayoutRequestIdRef.current !== requestId) return;
        setPdfPageAspectRatios({ url: file.url, value: aspectRatios });
      });
    },
    [file.url],
  );
  const handlePageIntersections = useCallback(
    (entries: IntersectionObserverEntry[]): void => {
      setVisiblePageNumbers((previous) => {
        let next: Set<number> | null = null;

        for (const entry of entries) {
          const pageNumber = Number(
            (entry.target as HTMLElement).dataset.pdfPageShell,
          );
          if (!Number.isInteger(pageNumber)) continue;

          const isVisible = entry.isIntersecting;
          if (previous.has(pageNumber) === isVisible) continue;

          next ??= new Set(previous);
          if (isVisible) {
            next.add(pageNumber);
          } else {
            next.delete(pageNumber);
          }
        }

        return next ?? previous;
      });
    },
    [],
  );
  const handlePdfPageLoadSuccess = useCallback(
    (
      pageNumber: number,
      loadedPageWidth: number,
      page: PdfPageLoadSuccess,
    ): void => {
      setPdfPageAspectRatios((previousState) => {
        const nextAspectRatio = page.height / loadedPageWidth;
        const previousAspectRatio = previousState.value.get(pageNumber);
        if (
          previousState.url === file.url &&
          previousAspectRatio === nextAspectRatio
        ) {
          return previousState;
        }

        const next =
          previousState.url === file.url
            ? new Map(previousState.value)
            : new Map<number, number>();
        next.set(pageNumber, nextAspectRatio);
        return { url: file.url, value: next };
      });
    },
    [file.url],
  );

  useEffect(() => {
    let isCurrent = true;

    void import("react-pdf").then((module) => {
      module.pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      if (isCurrent) setPdfModule(module);
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      pdfLayoutRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updatePageWidth = (): void => {
      setPageWidth(
        sourceOriginalPreviewModel.getPdfPageWidth(container.clientWidth),
      );
    };

    const observer = new ResizeObserver(updatePageWidth);
    updatePageWidth();
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [pdfModule]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      handlePageIntersections,
      { rootMargin: pdfPageObserverRootMargin },
    );
    pageObserverRef.current = observer;

    for (const shell of pageShellsRef.current.values()) {
      observer.observe(shell);
    }

    return () => {
      pageObserverRef.current = null;
      observer.disconnect();
    };
  }, [handlePageIntersections]);

  if (!pdfModule) return <LoadingPreview />;

  const Document = pdfModule.Document;
  const Page = pdfModule.Page;
  const shouldRenderAllPages = typeof IntersectionObserver === "undefined";
  const registerPageShell = (pageNumber: number): PdfPageShellRef =>
    (element) => {
      if (element) {
        pageShellsRef.current.set(pageNumber, element);
        pageObserverRef.current?.observe(element);
      } else {
        const previousElement = pageShellsRef.current.get(pageNumber);
        if (previousElement) {
          pageObserverRef.current?.unobserve(previousElement);
        }
        pageShellsRef.current.delete(pageNumber);
      }
    };

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center overflow-auto rounded-lg bg-muted/30 px-3 py-4"
    >
      <Document
        file={file.url}
        loading={<LoadingPreview />}
        error={<UnsupportedPreview />}
        onLoadSuccess={handlePdfLoadSuccess}
      >
        {hasLoadedPageLayout ? (
          Array.from({ length: resolvedPageCount }, (_, index) => (
            <LazyPdfPage
              key={`${file.url}:${index}`}
              PageComponent={Page}
              pageNumber={index + 1}
              pageCount={resolvedPageCount}
              width={pageWidth}
              aspectRatio={sourceOriginalPreviewModel.getPdfPageAspectRatio(
                resolvedPageAspectRatios,
                index + 1,
              )}
              shouldRender={
                shouldRenderAllPages || visiblePageNumbers.has(index + 1)
              }
              pageShellRef={registerPageShell(index + 1)}
              onPageLoadSuccess={handlePdfPageLoadSuccess}
            />
          ))
        ) : (
          <LoadingPreview />
        )}
      </Document>
    </div>
  );
}

const LazyPdfPage = memo(function LazyPdfPage({
  PageComponent,
  pageNumber,
  pageCount,
  width,
  aspectRatio,
  shouldRender,
  pageShellRef,
  onPageLoadSuccess,
}: LazyPdfPageProps): ReactNode {
  const placeholderHeight =
    sourceOriginalPreviewModel.getPdfPagePlaceholderHeight(width, aspectRatio);

  return (
    <div
      ref={pageShellRef}
      data-pdf-page-shell={pageNumber}
      className="mb-4 flex w-full flex-col items-center"
      style={{ minHeight: placeholderHeight }}
    >
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">
        Page {pageNumber} of {pageCount}
      </p>
      {shouldRender ? (
        <PageComponent
          pageNumber={pageNumber}
          width={width}
          devicePixelRatio={pdfCanvasDevicePixelRatio}
          renderAnnotationLayer={false}
          renderTextLayer={false}
          onLoadSuccess={(page) =>
            onPageLoadSuccess(pageNumber, width, page)
          }
          className="overflow-hidden rounded-lg shadow-sm"
        />
      ) : (
        <div
          className="rounded-lg border border-border/70 bg-background/80 shadow-sm"
          style={{ width, height: placeholderHeight }}
        />
      )}
    </div>
  );
}, areLazyPdfPagePropsEqual);

function areLazyPdfPagePropsEqual(
  previous: LazyPdfPageProps,
  next: LazyPdfPageProps,
): boolean {
  return (
    previous.PageComponent === next.PageComponent &&
    previous.pageNumber === next.pageNumber &&
    previous.pageCount === next.pageCount &&
    previous.width === next.width &&
    previous.aspectRatio === next.aspectRatio &&
    previous.shouldRender === next.shouldRender &&
    previous.onPageLoadSuccess === next.onPageLoadSuccess
  );
}

async function loadPdfPageAspectRatios(
  document: PdfDocumentLoadSuccess,
  pageCount: number,
  shouldContinue: () => boolean,
): Promise<PdfPageAspectRatios> {
  const aspectRatios = new Map<number, number>();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (!shouldContinue()) return aspectRatios;

    try {
      const page = await document.getPage(pageNumber);
      if (!shouldContinue()) return aspectRatios;
      const viewport = page.getViewport({ scale: 1 });
      aspectRatios.set(
        pageNumber,
        sourceOriginalPreviewModel.getSafePdfPageAspectRatio(
          viewport.width,
          viewport.height,
        ),
      );
    } catch {
      aspectRatios.set(
        pageNumber,
        sourceOriginalPreviewModel.pdfPageAspectRatio,
      );
    }
  }

  return aspectRatios;
}

function LoadingPreview(): ReactNode {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading preview...</p>
    </div>
  );
}

function UnsupportedPreview(): ReactNode {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <FileText className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        Preview is not available for this file.
      </p>
    </div>
  );
}
