"use client";

import {
  memo,
  type ReactNode,
} from "react";
import { FileText, Loader2 } from "lucide-react";

import { useSourceOriginalPdfWorkflow } from "@/components/source-original-pdf-workflow";
import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import type { SourceOriginalFileView } from "@/domains/sources/types";

type PdfWorkflow = ReturnType<typeof useSourceOriginalPdfWorkflow>;
type PdfPageComponent = NonNullable<PdfWorkflow["pdfModule"]>["Page"];
type PdfPageShellRef = ReturnType<PdfWorkflow["registerPageShell"]>;
type PdfPageLoadSuccess = Parameters<PdfWorkflow["handlePdfPageLoadSuccess"]>[2];
type LazyPdfPageProps = {
  readonly PageComponent: PdfPageComponent;
  readonly devicePixelRatio: number;
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

export function SourceOriginalPdfPreview({
  file,
  targetPageNumber = null,
  targetPageRequestId = 0,
}: {
  readonly file: SourceOriginalFileView;
  readonly targetPageNumber?: number | null;
  readonly targetPageRequestId?: number;
}): ReactNode {
  const {
    containerRef,
    fileSource,
    getPageAspectRatio,
    handlePdfLoadSuccess,
    handlePdfPageLoadSuccess,
    hasLoadedPageLayout,
    hasPdfFileLoadFailed,
    pageCount,
    pageWidth,
    pdfModule,
    registerPageShell,
    shouldRenderPage,
  } = useSourceOriginalPdfWorkflow({
    file,
    targetPageNumber,
    targetPageRequestId,
  });

  if (!pdfModule) return <LoadingPreview />;
  if (hasPdfFileLoadFailed) return <UnsupportedPreview />;
  if (!fileSource) return <LoadingPreview />;

  const Document = pdfModule.Document;
  const Page = pdfModule.Page;
  const pdfCanvasDevicePixelRatio =
    sourceOriginalPreviewModel.getPdfCanvasDevicePixelRatio();

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center overflow-auto rounded-lg bg-muted/30 px-3 py-4"
    >
      <Document
        file={fileSource}
        loading={<LoadingPreview />}
        error={<UnsupportedPreview />}
        onLoadSuccess={handlePdfLoadSuccess}
      >
        {hasLoadedPageLayout ? (
          Array.from({ length: pageCount }, (_, index) => (
            <LazyPdfPage
              key={`${file.url}:${index}`}
              PageComponent={Page}
              devicePixelRatio={pdfCanvasDevicePixelRatio}
              pageNumber={index + 1}
              pageCount={pageCount}
              width={pageWidth}
              aspectRatio={getPageAspectRatio(index + 1)}
              shouldRender={shouldRenderPage(index + 1)}
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
  devicePixelRatio,
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
          devicePixelRatio={devicePixelRatio}
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
    previous.devicePixelRatio === next.devicePixelRatio &&
    previous.pageNumber === next.pageNumber &&
    previous.pageCount === next.pageCount &&
    previous.width === next.width &&
    previous.aspectRatio === next.aspectRatio &&
    previous.shouldRender === next.shouldRender &&
    previous.onPageLoadSuccess === next.onPageLoadSuccess
  );
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
