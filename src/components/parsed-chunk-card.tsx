"use client";

import { useMemo, type ReactNode } from "react";
import { FileText, ImageIcon, Table2, Tags, TextQuote } from "lucide-react";
import DOMPurify from "dompurify";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { chunksPanelState } from "@/components/chunks-panel-state";
import type {
  ParsedChunkConnection,
  ParsedChunkView,
} from "@/domains/chunks/types";
import { cn } from "@/lib/utils";

const keywordPanelClassName =
  "rounded-lg border border-emerald-200/70 bg-emerald-50/70 p-3 shadow-[0_1px_0_rgba(16,185,129,0.08)] dark:border-emerald-400/20 dark:bg-emerald-950/20";
const keywordBadgeClassName =
  "rounded-md border border-emerald-200/80 bg-emerald-100/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 shadow-[0_1px_0_rgba(16,185,129,0.10)] hover:bg-emerald-100 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200";

export function ParsedChunkCard({
  chunk,
  isFocused,
  onReferenceClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  if (chunk.type === "image") {
    return (
      <div
        data-testid={`chunk-card-shell-${chunk.chunkId}`}
        className="w-full min-w-0"
      >
        <ImageChunkCard chunk={chunk} isFocused={isFocused} />
      </div>
    );
  }
  if (chunk.type === "table") {
    return (
      <div
        data-testid={`chunk-card-shell-${chunk.chunkId}`}
        className="w-full min-w-0"
      >
        <TableChunkCard chunk={chunk} isFocused={isFocused} />
      </div>
    );
  }
  return (
    <div
      data-testid={`chunk-card-shell-${chunk.chunkId}`}
      className="w-full min-w-0"
    >
      <TextChunkCard
        chunk={chunk}
        isFocused={isFocused}
        onReferenceClick={onReferenceClick}
      />
    </div>
  );
}

function ChunkCardFrame({
  chunk,
  isFocused,
  children,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card
      className={cn(
        "w-full min-w-0 cursor-default overflow-hidden rounded-lg shadow-xs transition-colors",
        focusCardClasses(isFocused),
      )}
    >
      <CardContent className="space-y-3 p-3 sm:p-4">
        <ChunkSourcePanel chunk={chunk} />
        {children}
      </CardContent>
    </Card>
  );
}

function ChunkSourcePanel({
  chunk,
}: {
  readonly chunk: ParsedChunkView;
}): ReactNode {
  const pageLabel: string | null = formatPageNumbers(chunk.pageNums);
  const sectionLabel: string | null = chunksPanelState.formatChunkSectionPath(
    chunk.sectionPath,
  );

  return (
    <section
      data-testid={`chunk-source-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-background/80 p-3"
    >
      <div className="flex min-w-0 gap-3">
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
              {getChunkTypeLabel(chunk.type)}
            </Badge>
            {pageLabel ? (
              <Badge
                variant="secondary"
                className="h-5 rounded-md px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                {pageLabel}
              </Badge>
            ) : null}
          </div>
          {sectionLabel ? (
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
              {sectionLabel}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
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
      <p className="mt-2 text-sm leading-6 text-foreground/85">{chunk.summary}</p>
    </section>
  );
}

function ChunkContentPanel({
  chunk,
  children,
}: {
  readonly chunk: ParsedChunkView;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      data-testid={`chunk-content-panel-${chunk.chunkId}`}
      className="rounded-lg border border-border/70 bg-card p-3"
    >
      <SectionLabel icon={<FileText className="size-3.5" />} label="Content" />
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

function focusCardClasses(isFocused: boolean): string {
  return isFocused
    ? "citation-card-highlight border-primary/70 bg-primary/5 ring-2 ring-primary/30 shadow-md"
    : "hover:border-primary/30";
}

function TextChunkCard({
  chunk,
  isFocused,
  onReferenceClick,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
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

function ImageChunkCard({
  chunk,
  isFocused,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
}): ReactNode {
  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
      <ChunkSummaryPanel chunk={chunk} />
      <ChunkContentPanel chunk={chunk}>
        {chunk.assetUrl ? (
          <figure className="overflow-hidden rounded-lg border border-border bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element -- Parsed artifact dimensions are not known before render. */}
            <img
              src={chunk.assetUrl}
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
                {chunk.summary ?? "Image content is not available in this view."}
              </p>
            </div>
          </div>
        )}
      </ChunkContentPanel>
      <ChunkKeywords chunk={chunk} />
    </ChunkCardFrame>
  );
}

function renderTextChunkContent(
  chunk: ParsedChunkView,
  onReferenceClick: (chunkId: string) => void,
): ReactNode {
  const references = chunksPanelState.getRenderableReferences(chunk);
  if (references.length === 0) return chunk.content;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  references.forEach((reference, index) => {
    if (reference.start > cursor) {
      nodes.push(chunk.content.slice(cursor, reference.start));
    }
    nodes.push(
      <ChunkReferenceButton
        key={`${reference.connection.ref ?? "ref"}-${index}`}
        connection={reference.connection}
        onReferenceClick={onReferenceClick}
      />,
    );
    cursor = reference.end;
  });

  if (cursor < chunk.content.length) {
    nodes.push(chunk.content.slice(cursor));
  }

  return nodes;
}

function ChunkReferenceButton({
  connection,
  onReferenceClick,
}: {
  readonly connection: ParsedChunkConnection;
  readonly onReferenceClick: (chunkId: string) => void;
}): ReactNode {
  const isResolved = typeof connection.targetChunkId === "string";
  const label = chunksPanelState.getReferenceLabel(connection);

  return (
    <button
      type="button"
      disabled={!isResolved}
      aria-disabled={!isResolved}
      className="mx-0.5 inline-flex max-w-full items-center rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium leading-5 text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
      onClick={() => {
        if (connection.targetChunkId) onReferenceClick(connection.targetChunkId);
      }}
    >
      {label}
    </button>
  );
}

function TableChunkCard({
  chunk,
  isFocused,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
}): ReactNode {
  const hasHtml = chunk.content.trim().startsWith("<");

  const safeHtml = useMemo(
    () =>
      hasHtml
        ? DOMPurify.sanitize(chunk.content, {
            ALLOWED_TAGS: [
              "table",
              "thead",
              "tbody",
              "tfoot",
              "tr",
              "th",
              "td",
              "caption",
              "colgroup",
              "col",
            ],
            ALLOWED_ATTR: ["colspan", "rowspan", "scope", "align"],
          })
        : null,
    [chunk.content, hasHtml],
  );

  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
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
                {chunk.summary ?? "Table content is not available in this view."}
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
  if (type === "image") return <ImageIcon className="size-4" />;
  if (type === "table") return <Table2 className="size-4" />;
  return <FileText className="size-4" />;
}

function getChunkIconClasses(type: ParsedChunkView["type"]): string {
  if (type === "image") {
    return "border-violet-500/15 bg-violet-500/10 text-violet-600 dark:text-violet-300";
  }
  if (type === "table") {
    return "border-primary/15 bg-primary/10 text-primary";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}

function getChunkTypeLabel(type: ParsedChunkView["type"]): string {
  if (type === "image") return "Image";
  if (type === "table") return "Table";
  return "Text";
}

function formatPageNumbers(
  pageNums: ParsedChunkView["pageNums"],
): string | null {
  if (!pageNums || pageNums.length === 0) return null;

  const uniquePageNums = Array.from(new Set(pageNums)).sort(
    (leftPageNum, rightPageNum) => leftPageNum - rightPageNum,
  );
  if (uniquePageNums.length === 1) return `Page ${uniquePageNums[0]}`;

  const visiblePageNums = uniquePageNums.slice(0, 3).join(", ");
  const suffix = uniquePageNums.length > 3 ? "..." : "";
  return `Pages ${visiblePageNums}${suffix}`;
}
