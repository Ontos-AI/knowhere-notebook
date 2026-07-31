"use client";

import { useMemo, type MouseEvent, type ReactNode } from "react";
import { FileSearch, FileText, ImageIcon, Table2, Tags, TextQuote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { parsedChunkCardModel } from "@/components/parsed-chunk-card-model";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceOriginalFileView } from "@/domains/sources/types";
import { cn } from "@/lib/utils";

const keywordPanelClassName =
  "rounded-lg border border-emerald-200/70 bg-emerald-50/70 p-3 shadow-[0_1px_0_rgba(16,185,129,0.08)] dark:border-emerald-400/20 dark:bg-emerald-950/20";
const keywordBadgeClassName =
  "rounded-md border border-emerald-200/80 bg-emerald-100/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 shadow-[0_1px_0_rgba(16,185,129,0.10)] hover:bg-emerald-100 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200";
type TextChunkReferencePart = Extract<
  ReturnType<typeof parsedChunkCardModel.getTextContentParts>[number],
  { readonly type: "reference" }
>;

export function ParsedChunkCard({
  chunk,
  isFocused,
  isOriginalPreviewAvailable = false,
  onChunkClick,
  onReferenceClick,
  sourceOriginalFile = null,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly isOriginalPreviewAvailable?: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
  readonly onReferenceClick: (chunkId: string) => void;
  readonly sourceOriginalFile?: SourceOriginalFileView | null;
}): ReactNode {
  if (chunk.type === "page") {
    return (
      <ChunkCardShell chunk={chunk}>
        <PageChunkCard
          chunk={chunk}
          isFocused={isFocused}
          isOriginalPreviewAvailable={isOriginalPreviewAvailable}
          onChunkClick={onChunkClick}
        />
      </ChunkCardShell>
    );
  }
  if (chunk.type === "image") {
    return (
      <ChunkCardShell chunk={chunk}>
        <ImageChunkCard
          chunk={chunk}
          isFocused={isFocused}
          isOriginalPreviewAvailable={isOriginalPreviewAvailable}
          onChunkClick={onChunkClick}
          sourceOriginalFile={sourceOriginalFile}
        />
      </ChunkCardShell>
    );
  }
  if (chunk.type === "table") {
    return (
      <ChunkCardShell chunk={chunk}>
        <TableChunkCard
          chunk={chunk}
          isFocused={isFocused}
          isOriginalPreviewAvailable={isOriginalPreviewAvailable}
          onChunkClick={onChunkClick}
        />
      </ChunkCardShell>
    );
  }
  return (
    <ChunkCardShell chunk={chunk}>
      <TextChunkCard
        chunk={chunk}
        isFocused={isFocused}
        isOriginalPreviewAvailable={isOriginalPreviewAvailable}
        onChunkClick={onChunkClick}
        onReferenceClick={onReferenceClick}
      />
    </ChunkCardShell>
  );
}

function ChunkCardShell({
  chunk,
  children,
}: {
  readonly chunk: ParsedChunkView;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      data-testid={`chunk-card-shell-${chunk.chunkId}`}
      className="w-full min-w-0"
    >
      {children}
    </div>
  );
}

function ChunkCardFrame({
  chunk,
  isFocused,
  isOriginalPreviewAvailable,
  onChunkClick,
  children,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card
      className={cn(
        "w-full min-w-0 cursor-default overflow-hidden rounded-lg shadow-xs transition-colors",
        parsedChunkCardModel.getFocusCardClasses(isFocused),
      )}
    >
      <CardContent className="space-y-3 p-3 sm:p-4">
        <ChunkSourcePanel
          chunk={chunk}
          isOriginalPreviewAvailable={isOriginalPreviewAvailable}
          onChunkClick={onChunkClick}
        />
        {children}
      </CardContent>
    </Card>
  );
}

function ChunkSourcePanel({
  chunk,
  isOriginalPreviewAvailable,
  onChunkClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
}): ReactNode {
  const sourceMetadata = parsedChunkCardModel.getSourceMetadata(chunk);
  const firstPageNumber = getFirstValidPageNumber(chunk);

  return (
    <section
      data-testid={`chunk-source-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-background/80 p-3"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <div
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg border shadow-inner",
              getChunkIconClasses(chunk.type),
            )}
          >
            {renderChunkIcon(chunk.type)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="h-5 rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                {sourceMetadata.typeLabel}
              </Badge>
              {sourceMetadata.pageLabel ? (
                <Badge
                  variant="secondary"
                  className="h-5 rounded-md px-1.5 text-[10px] font-semibold text-muted-foreground"
                >
                  {sourceMetadata.pageLabel}
                </Badge>
              ) : null}
            </div>
            {sourceMetadata.sectionLabel ? (
              <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                {sourceMetadata.sectionLabel}
              </p>
            ) : null}
          </div>
        </div>
        {onChunkClick && firstPageNumber !== null ? (
          <OpenOriginalButton
            chunk={chunk}
            firstPageNumber={firstPageNumber}
            isOriginalPreviewAvailable={isOriginalPreviewAvailable}
            onChunkClick={onChunkClick}
          />
        ) : null}
      </div>
    </section>
  );
}

function getFirstValidPageNumber(chunk: ParsedChunkView): number | null {
  const pageNums = chunk.pageNums ?? [];
  const validPageNums = pageNums.filter(
    (pageNum) => Number.isFinite(pageNum) && pageNum > 0,
  );
  if (validPageNums.length === 0) return null;

  return Math.min(...validPageNums);
}

function OpenOriginalButton({
  chunk,
  firstPageNumber,
  isOriginalPreviewAvailable,
  onChunkClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly firstPageNumber: number;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick: (chunk: ParsedChunkView) => void;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-8 shrink-0 rounded-md px-2.5 text-xs",
        isOriginalPreviewAvailable
          ? "border-primary/40 bg-primary/5 font-semibold text-primary hover:bg-primary/10 hover:text-primary"
          : "font-normal text-muted-foreground",
      )}
      onClick={() => onChunkClick(chunk)}
    >
      <FileSearch className="size-3.5" />
      {getOpenOriginalButtonLabel(firstPageNumber, isOriginalPreviewAvailable)}
    </Button>
  );
}

function getOpenOriginalButtonLabel(
  firstPageNumber: number,
  isOriginalPreviewAvailable: boolean,
): string {
  if (!isOriginalPreviewAvailable) return "Open original file";

  return `Open page ${firstPageNumber} in original file`;
}

function ChunkSummaryPanel({
  chunk,
}: {
  readonly chunk: ParsedChunkView;
}): ReactNode {
  if (!chunk.summary) return null;

  return (
    <section
      data-testid={`chunk-summary-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-muted/35 p-3"
    >
      <SectionLabel icon={<TextQuote className="size-3.5" />} label="Summary" />
      <p className="mt-2 text-sm leading-6 text-foreground/85">
        {chunk.summary}
      </p>
    </section>
  );
}

function ChunkContentPanel({
  chunk,
  label = "Content",
  children,
}: {
  readonly chunk: ParsedChunkView;
  readonly label?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      data-testid={`chunk-content-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-card p-3"
    >
      <SectionLabel icon={<FileText className="size-3.5" />} label={label} />
      <div className="mt-2 min-w-0">{children}</div>
    </section>
  );
}

function ChunkKeywords({
  chunk,
}: {
  readonly chunk: ParsedChunkView;
}): ReactNode {
  if (!chunk.keywords || chunk.keywords.length === 0) return null;

  return (
    <section
      data-testid={`chunk-keywords-panel-${chunk.chunkId}`}
      className={keywordPanelClassName}
    >
      <SectionLabel
        icon={<Tags className="size-3.5" />}
        label="Keywords"
        className="text-emerald-800 dark:text-emerald-200"
        iconClassName="text-emerald-600 dark:text-emerald-300"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chunk.keywords.map((keyword) => (
          <Badge
            key={keyword}
            variant="secondary"
            className={keywordBadgeClassName}
          >
            {keyword}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function SectionLabel({
  icon,
  label,
  className,
  iconClassName,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly className?: string;
  readonly iconClassName?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground",
        className,
      )}
    >
      <span className={cn("text-primary", iconClassName)}>{icon}</span>
      {label}
    </div>
  );
}

function TextChunkCard({
  chunk,
  isFocused,
  isOriginalPreviewAvailable,
  onChunkClick,
  onReferenceClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
  readonly onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  return (
    <ChunkCardFrame
      chunk={chunk}
      isFocused={isFocused}
      isOriginalPreviewAvailable={isOriginalPreviewAvailable}
      onChunkClick={onChunkClick}
    >
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground sm:text-sm">
          {renderTextChunkContent(chunk, onReferenceClick)}
        </pre>
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function PageChunkCard({
  chunk,
  isFocused,
  isOriginalPreviewAvailable,
  onChunkClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
}): ReactNode {
  return (
    <ChunkCardFrame
      chunk={chunk}
      isFocused={isFocused}
      isOriginalPreviewAvailable={isOriginalPreviewAvailable}
      onChunkClick={onChunkClick}
    >
      <ChunkContentPanel chunk={chunk} label="Page summary">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground sm:text-sm">
          {chunk.readableContent ?? chunk.content}
        </p>
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function ImageChunkCard({
  chunk,
  isFocused,
  isOriginalPreviewAvailable,
  onChunkClick,
  sourceOriginalFile,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
  readonly sourceOriginalFile: SourceOriginalFileView | null;
}): ReactNode {
  const imageAssetUrl = getImageChunkAssetUrl(chunk, sourceOriginalFile);

  return (
    <ChunkCardFrame
      chunk={chunk}
      isFocused={isFocused}
      isOriginalPreviewAvailable={isOriginalPreviewAvailable}
      onChunkClick={onChunkClick}
    >
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        {imageAssetUrl ? (
          <figure className="overflow-hidden rounded-lg border border-border bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element -- Parsed artifact dimensions are not known before render. */}
            <img
              src={imageAssetUrl}
              alt={chunk.summary ?? "Image chunk"}
              className="max-h-[520px] w-full object-contain"
            />
          </figure>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 py-8 text-center">
            <ImageIcon className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Image chunk
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {chunk.summary
                  ? chunk.summary
                  : "Image content is not available in this view."}
              </p>
            </div>
          </div>
        )}
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function getImageChunkAssetUrl(
  chunk: ParsedChunkView,
  sourceOriginalFile: SourceOriginalFileView | null,
): string | null {
  if (chunk.assetUrl) return chunk.assetUrl;
  if (!sourceOriginalFile?.mimeType.startsWith("image/")) return null;

  return sourceOriginalFile.url;
}

function renderTextChunkContent(
  chunk: ParsedChunkView,
  onReferenceClick: (chunkId: string) => void,
): ReactNode {
  const parts = parsedChunkCardModel.getTextContentParts(chunk);
  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text;
  }

  return parts.map((part) => {
    if (part.type === "text") {
      return part.text;
    }

    return (
      <ChunkReferenceButton
        key={part.key}
        reference={part}
        onReferenceClick={onReferenceClick}
      />
    );
  });
}

function ChunkReferenceButton({
  reference,
  onReferenceClick,
}: {
  readonly reference: TextChunkReferencePart;
  readonly onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={!reference.isResolved}
      aria-disabled={!reference.isResolved}
      className="mx-0.5 inline-flex max-w-full items-center rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium leading-5 text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (reference.targetChunkId) onReferenceClick(reference.targetChunkId);
      }}
    >
      {reference.label}
    </button>
  );
}

function TableChunkCard({
  chunk,
  isFocused,
  isOriginalPreviewAvailable,
  onChunkClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly isOriginalPreviewAvailable: boolean;
  readonly onChunkClick?: (chunk: ParsedChunkView) => void;
}): ReactNode {
  const safeHtml = useMemo(
    () => parsedChunkCardModel.getSanitizedTableHtml(chunk.content),
    [chunk.content],
  );

  return (
    <ChunkCardFrame
      chunk={chunk}
      isFocused={isFocused}
      isOriginalPreviewAvailable={isOriginalPreviewAvailable}
      onChunkClick={onChunkClick}
    >
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        {safeHtml ? (
          <div
            data-testid={`chunk-table-content-${chunk.chunkId}`}
            className="prose prose-sm max-w-full overflow-x-auto text-sm leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 py-8 text-center">
            <Table2 className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Table chunk
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {chunk.summary
                  ? chunk.summary
                  : "Table content is not available in this view."}
              </p>
            </div>
          </div>
        )}
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function renderChunkIcon(type: ParsedChunkView["type"]): ReactNode {
  if (type === "page") return <FileSearch className="size-4" />;
  if (type === "image") return <ImageIcon className="size-4" />;
  if (type === "table") return <Table2 className="size-4" />;
  return <FileText className="size-4" />;
}

function getChunkIconClasses(type: ParsedChunkView["type"]): string {
  if (type === "page") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (type === "image") {
    return "border-violet-500/15 bg-violet-500/10 text-violet-600 dark:text-violet-300";
  }
  if (type === "table") {
    return "border-primary/15 bg-primary/10 text-primary";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}
