"use client";

import {
  type ReactNode,
} from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import { SourceOriginalTextPreview } from "@/components/source-original-text-preview";
import { SourceOriginalDocxPreview } from "@/components/source-original-docx-preview";
import { SourceOriginalPdfPreview } from "@/components/source-original-pdf-preview";
import type { SourceOriginalFileView } from "@/domains/sources/types";

type SourceOriginalPreviewProps = {
  sourceTitle: string;
  file: SourceOriginalFileView | null;
  targetPageNumber?: number | null;
  targetPageRequestId?: number;
};

type PreviewKind = ReturnType<typeof sourceOriginalPreviewModel.getPreviewKind>;

export function SourceOriginalPreview({
  sourceTitle,
  file,
  targetPageNumber = null,
  targetPageRequestId = 0,
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

  const kind = sourceOriginalPreviewModel.getPreviewKind(
    sourceTitle,
    file.mimeType,
  );
  const canDownload = file.canDownload !== false;

  return (
    <div
      data-testid="source-original-preview"
      data-target-page={targetPageNumber ?? undefined}
      className={getPreviewShellClassName()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/80 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {sourceTitle}
          </p>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {sourceOriginalPreviewModel.getPreviewLabel(kind)}
          </p>
        </div>
        {canDownload ? (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a
              href={sourceOriginalPreviewModel.getOriginalDownloadUrl(file.url)}
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
        {renderPreview(kind, sourceTitle, file, {
          targetPageNumber,
          targetPageRequestId,
        })}
      </div>
    </div>
  );
}

function getPreviewShellClassName(): string {
  return "mx-auto flex w-[90%] min-w-0 max-w-[1600px] flex-col gap-3 p-3 sm:p-6";
}

function renderPreview(
  kind: PreviewKind,
  sourceTitle: string,
  file: SourceOriginalFileView,
  options: {
    readonly targetPageNumber: number | null;
    readonly targetPageRequestId: number;
  },
): ReactNode {
  if (!sourceOriginalPreviewModel.isWithinPreviewByteLimit(kind, file)) {
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
      if (file.pdfPreviewMode === "browser") {
        return (
          <BrowserPdfPreview
            sourceTitle={sourceTitle}
            file={file}
            targetPageNumber={options.targetPageNumber}
            targetPageRequestId={options.targetPageRequestId}
          />
        );
      }
      return (
        <SourceOriginalPdfPreview
          key={file.url}
          file={file}
          targetPageNumber={options.targetPageNumber}
          targetPageRequestId={options.targetPageRequestId}
        />
      );
    case "markdown":
      return renderReadingPreview(file, "markdown");
    case "text":
      return renderReadingPreview(file, "text");
    case "docx":
      return <SourceOriginalDocxPreview file={file} />;
    case "unsupported":
      return <UnsupportedPreview />;
  }
}

function renderReadingPreview(
  file: SourceOriginalFileView,
  variant: "markdown" | "text",
): ReactNode {
  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl">
      <SourceOriginalTextPreview file={file} variant={variant} />
    </div>
  );
}

function BrowserPdfPreview({
  sourceTitle,
  file,
  targetPageNumber,
  targetPageRequestId,
}: {
  readonly sourceTitle: string;
  readonly file: SourceOriginalFileView;
  readonly targetPageNumber: number | null;
  readonly targetPageRequestId: number;
}): ReactNode {
  const previewUrl = sourceOriginalPreviewModel.getBrowserPdfPreviewUrl(
    file.url,
    targetPageNumber,
  );

  return (
    <iframe
      key={`${previewUrl}:${targetPageRequestId}`}
      title={`${sourceTitle} original PDF`}
      src={previewUrl}
      className="h-[calc(100dvh-18rem)] min-h-[520px] w-full rounded-md border-0 bg-background"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
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
