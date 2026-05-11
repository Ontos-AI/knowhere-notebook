"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DOMPurify from "dompurify";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SourceOriginalFileView } from "@/lib/types";

type SourceOriginalPreviewProps = {
  sourceTitle: string;
  file: SourceOriginalFileView | null;
};

type PreviewKind =
  | "pdf"
  | "image"
  | "text"
  | "markdown"
  | "docx"
  | "unsupported";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "failed" };

type UrlLoadState<T> = {
  readonly url: string;
  readonly state: LoadState<T>;
};

type UrlValue<T> = {
  readonly url: string;
  readonly value: T;
};

type MammothConverter = {
  readonly convertToHtml: (input: {
    readonly arrayBuffer: ArrayBuffer;
  }) => Promise<{
    readonly value: string;
  }>;
};

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

const pdfPageAspectRatio = 1.414;
const pdfCanvasDevicePixelRatio = 2;
const pdfPageMaxWidth = 1600;
const pdfPageObserverRootMargin = "600px 0px";
const TEXT_PREVIEW_BYTE_LIMIT = 1024 * 1024;
const DOCX_PREVIEW_BYTE_LIMIT = 10 * 1024 * 1024;

export function SourceOriginalPreview({
  sourceTitle,
  file,
}: SourceOriginalPreviewProps): ReactNode {
  if (!file) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-14 text-center sm:py-20">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <FileText className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          Original file is not available.
        </p>
      </div>
    );
  }

  const kind = getPreviewKind(sourceTitle, file.mimeType);
  const canDownload = file.canDownload !== false;

  return (
    <div className="mx-auto flex w-[90%] min-w-0 max-w-[1600px] flex-col gap-3 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/80 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {sourceTitle}
          </p>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {getPreviewLabel(kind)}
          </p>
        </div>
        {canDownload ? (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a
              href={getOriginalDownloadUrl(file.url)}
              download={sourceTitle}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="size-4" />
              Download original file
            </a>
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 rounded-lg border border-border/70 bg-card p-3">
        {renderPreview(kind, sourceTitle, file)}
      </div>
    </div>
  );
}

function renderPreview(
  kind: PreviewKind,
  sourceTitle: string,
  file: SourceOriginalFileView,
): ReactNode {
  if (!isWithinPreviewByteLimit(kind, file)) {
    return <UnsupportedPreview />;
  }

  switch (kind) {
    case "image":
      return (
        <figure className="flex justify-center overflow-auto rounded-lg bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element -- Original files are user uploads with unknown dimensions. */}
          <img
            src={file.url}
            alt={sourceTitle}
            className="max-h-[calc(100dvh-14rem)] max-w-full object-contain"
          />
        </figure>
      );
    case "pdf":
      return <PdfPreview key={file.url} file={file} />;
    case "markdown":
      return <MarkdownPreview file={file} />;
    case "text":
      return <TextPreview file={file} />;
    case "docx":
      return <DocxPreview file={file} />;
    case "unsupported":
      return <UnsupportedPreview />;
  }
}

function PdfPreview({ file }: { file: SourceOriginalFileView }): ReactNode {
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
  const [pageWidth, setPageWidth] = useState(getInitialPdfPageWidth);
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
      setPageWidth(getPdfPageWidth(container.clientWidth));
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
              aspectRatio={getPdfPageAspectRatio(
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
  const placeholderHeight = getPdfPagePlaceholderHeight(width, aspectRatio);

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

function MarkdownPreview({ file }: { file: SourceOriginalFileView }): ReactNode {
  const state = useTextFile(file.url);

  if (state.status === "loading") return <LoadingPreview />;
  if (state.status === "failed") return <UnsupportedPreview />;

  return (
    <div className="original-markdown-preview min-w-0 max-w-full overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {normalizeMarkdownPreviewText(state.value)}
      </ReactMarkdown>
    </div>
  );
}

function TextPreview({ file }: { file: SourceOriginalFileView }): ReactNode {
  const state = useTextFile(file.url);

  if (state.status === "loading") return <LoadingPreview />;
  if (state.status === "failed") return <UnsupportedPreview />;

  return (
    <pre className="max-h-[calc(100dvh-14rem)] overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground sm:text-sm">
      {state.value}
    </pre>
  );
}

function DocxPreview({ file }: { file: SourceOriginalFileView }): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadState, setLoadState] = useState<UrlLoadState<null>>({
    url: file.url,
    state: { status: "loading" },
  });
  const status: LoadState<null> =
    loadState.url === file.url ? loadState.state : { status: "loading" };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerElement: HTMLElement = container;

    let isCurrent = true;
    const controller = new AbortController();
    containerElement.replaceChildren();

    async function renderDocx(): Promise<void> {
      try {
        const [response, module] = await Promise.all([
          fetch(file.url, { signal: controller.signal }),
          import("docx-preview"),
        ]);
        if (!response.ok) throw new Error("DOCX download failed.");
        const data = await response.arrayBuffer();
        if (!isCurrent) return;
        try {
          await module.renderAsync(data, containerElement, undefined, {
            ignoreFonts: true,
            ignoreWidth: true,
            renderAltChunks: false,
            useBase64URL: true,
          });
        } catch {
          if (!isCurrent) return;
          containerElement.replaceChildren();
          await renderDocxHtmlFallback(data, containerElement);
        }
        if (!isCurrent) return;
        DOMPurify.sanitize(containerElement, { IN_PLACE: true });
        if (isCurrent) {
          setLoadState({
            url: file.url,
            state: { status: "ready", value: null },
          });
        }
      } catch {
        if (isCurrent) {
          setLoadState({ url: file.url, state: { status: "failed" } });
        }
      }
    }

    void renderDocx();

    return () => {
      isCurrent = false;
      controller.abort();
      containerElement.replaceChildren();
    };
  }, [file.url]);

  return (
    <div className="min-h-[320px] overflow-auto rounded-lg bg-muted/30 p-3">
      {status.status === "loading" ? <LoadingPreview /> : null}
      {status.status === "failed" ? <UnsupportedPreview /> : null}
      <div
        key={file.url}
        ref={containerRef}
        className="original-docx-preview mx-auto max-w-full overflow-auto rounded-lg bg-background text-foreground"
      />
    </div>
  );
}

async function renderDocxHtmlFallback(
  data: ArrayBuffer,
  containerElement: HTMLElement,
): Promise<void> {
  const mammothModule = await import("mammoth");
  const converter = getMammothConverter(mammothModule);
  const result = await converter.convertToHtml({ arrayBuffer: data });
  containerElement.innerHTML = DOMPurify.sanitize(result.value);
}

function getMammothConverter(moduleValue: unknown): MammothConverter {
  const moduleRecord = moduleValue as {
    readonly default?: unknown;
    readonly convertToHtml?: unknown;
  };

  if (isMammothConverter(moduleRecord.default)) {
    return moduleRecord.default;
  }
  if (isMammothConverter(moduleRecord)) {
    return moduleRecord;
  }

  throw new Error("Mammoth DOCX converter is unavailable.");
}

function isMammothConverter(value: unknown): value is MammothConverter {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { readonly convertToHtml?: unknown }).convertToHtml === "function";
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

function useTextFile(url: string): LoadState<string> {
  const [loadState, setLoadState] = useState<UrlLoadState<string>>({
    url,
    state: { status: "loading" },
  });

  useEffect(() => {
    let isCurrent = true;
    const controller = new AbortController();

    async function loadText(): Promise<void> {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Text download failed.");
        const value = await response.text();
        if (isCurrent) {
          setLoadState({ url, state: { status: "ready", value } });
        }
      } catch {
        if (isCurrent) {
          setLoadState({ url, state: { status: "failed" } });
        }
      }
    }

    void loadText();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [url]);

  return loadState.url === url ? loadState.state : { status: "loading" };
}

function getPreviewKind(title: string, mimeType: string): PreviewKind {
  const extension = getExtension(title);
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMimeType === "text/markdown" || extension === "md") {
    return "markdown";
  }
  if (normalizedMimeType.startsWith("text/") || extension === "txt") {
    return "text";
  }
  if (
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "docx";
  }
  return "unsupported";
}

function getPreviewLabel(kind: PreviewKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "image":
      return "Image";
    case "markdown":
      return "Markdown";
    case "text":
      return "Text";
    case "docx":
      return "Word";
    case "unsupported":
      return "Download";
  }
}

function isWithinPreviewByteLimit(
  kind: PreviewKind,
  file: SourceOriginalFileView,
): boolean {
  if (file.sizeBytes === undefined) return true;
  if (kind === "text" || kind === "markdown") {
    return file.sizeBytes <= TEXT_PREVIEW_BYTE_LIMIT;
  }
  if (kind === "docx") {
    return file.sizeBytes <= DOCX_PREVIEW_BYTE_LIMIT;
  }

  return true;
}

function getExtension(title: string): string | null {
  const index = title.lastIndexOf(".");
  if (index < 0 || index === title.length - 1) return null;
  return title.slice(index + 1).toLowerCase();
}

function normalizeMarkdownPreviewText(value: string): string {
  return value.replace(/(?:<br\s*\/?>|&lt;br\s*\/?&gt;)/gi, "\n");
}

function getPdfPageWidth(containerWidth: number): number {
  const horizontalPadding = 32;
  const availableWidth = Math.max(1, containerWidth - horizontalPadding);
  return Math.min(pdfPageMaxWidth, availableWidth);
}

function getPdfPagePlaceholderHeight(
  width: number,
  aspectRatio: number,
): number {
  return Math.round(width * aspectRatio);
}

function getPdfPageAspectRatio(
  pageAspectRatios: PdfPageAspectRatios,
  pageNumber: number,
): number {
  return pageAspectRatios.get(pageNumber) ?? pdfPageAspectRatio;
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
        getSafePdfPageAspectRatio(viewport.width, viewport.height),
      );
    } catch {
      aspectRatios.set(pageNumber, pdfPageAspectRatio);
    }
  }

  return aspectRatios;
}

function getSafePdfPageAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return pdfPageAspectRatio;
  }
  if (width <= 0 || height <= 0) return pdfPageAspectRatio;
  return height / width;
}

function getInitialPdfPageWidth(): number {
  if (typeof window === "undefined") return 640;
  return Math.max(1, Math.min(640, window.innerWidth - 48));
}

function getOriginalDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".blob.vercel-storage.com")) {
      parsed.searchParams.set("download", "1");
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}
