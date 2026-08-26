"use client";

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ImageIcon, ImageOff, Link2, Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { parsedChunkCardModel } from "@/components/parsed-chunk-card-model";
import { CitationRegionHighlight } from "@/components/citation-region-highlight";
import type { ChatImageHighlightBox } from "@/domains/chat/types";
import type { ParsedChunkView } from "@/domains/chunks/types";
import type { SourceOriginalFileView } from "@/domains/sources/types";
import { cn } from "@/lib/utils";

const entityBadgeClassName =
  "rounded-md border border-primary/35 bg-background px-2 py-0.5 text-[11px] font-medium text-primary";
type TextChunkReferencePart = Extract<
  ReturnType<typeof parsedChunkCardModel.getTextContentParts>[number],
  { readonly type: "reference" }
>;

export function ParsedChunkCard({
  chunk,
  isFocused,
  focusedCitationId = null,
  focusedPageNumber = null,
  focusedPageRequestId = 0,
  highlightRegions = [],
  onReferenceClick,
  sourceOriginalFile = null,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly focusedCitationId?: string | null;
  readonly focusedPageNumber?: number | null;
  readonly focusedPageRequestId?: number;
  readonly highlightRegions?: readonly ChatImageHighlightBox[];
  readonly onReferenceClick: (chunkId: string) => void;
  readonly sourceOriginalFile?: SourceOriginalFileView | null;
}): ReactNode {
  if (chunk.type === "page") {
    return (
      <ChunkCardShell chunk={chunk}>
        <PageChunkCard
          chunk={chunk}
          isFocused={isFocused}
          focusedCitationId={focusedCitationId}
          focusedPageNumber={focusedPageNumber}
          focusedPageRequestId={focusedPageRequestId}
          highlightRegions={highlightRegions}
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
          focusedPageRequestId={focusedPageRequestId}
          highlightRegions={highlightRegions}
          sourceOriginalFile={sourceOriginalFile}
        />
      </ChunkCardShell>
    );
  }
  if (chunk.type === "table") {
    return (
      <ChunkCardShell chunk={chunk}>
        <TableChunkCard chunk={chunk} isFocused={isFocused} />
      </ChunkCardShell>
    );
  }
  return (
    <ChunkCardShell chunk={chunk}>
      <TextChunkCard
        chunk={chunk}
        isFocused={isFocused}
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
  children,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card
      className={cn(
        "w-full min-w-0 cursor-default gap-0 overflow-hidden rounded-lg py-0 shadow-xs transition-colors",
        parsedChunkCardModel.getFocusCardClasses(isFocused),
      )}
    >
      <ChunkSourcePanel chunk={chunk} />
      <CardContent className="space-y-3 p-3 sm:p-4">
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
  const sourceMetadata = parsedChunkCardModel.getSourceMetadata(chunk);
  const lastSegmentIndex = sourceMetadata.sectionSegments.length - 1;

  return (
    <section
      data-testid={`chunk-source-panel-${chunk.chunkId}`}
      className="flex min-w-0 items-center gap-3 border-b border-[#f3f4f6] bg-[rgba(249,250,251,0.6)] px-5 pt-[10px] pb-[11px] dark:border-border dark:bg-muted/40"
    >
      <span className="inline-flex h-[27px] shrink-0 items-center rounded-[10px] border border-[#e5e7eb] bg-white px-2 py-1 text-[11px] font-semibold leading-[16.5px] tracking-normal text-[#27272a] dark:border-border dark:bg-card dark:text-card-foreground">
        {sourceMetadata.leadLabel}
      </span>
      {sourceMetadata.sectionSegments.length > 0 ? (
        <nav
          aria-label="Section path"
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {sourceMetadata.sectionSegments.map((segment, index) => {
            const isCurrent = index === lastSegmentIndex;
            return (
              <span
                key={`${segment}-${index}`}
                className="flex min-w-0 items-center gap-1"
              >
                {index > 0 ? (
                  <span className="shrink-0 text-[10px] leading-[15px] text-[#d1d5dc] dark:text-border">
                    /
                  </span>
                ) : null}
                <span
                  className={
                    isCurrent
                      ? "truncate text-[12px] font-medium leading-[18px] text-[#27272a] dark:text-foreground"
                      : "shrink-0 text-[12px] font-normal leading-[18px] text-[#71717b] dark:text-muted-foreground"
                  }
                >
                  {segment}
                </span>
              </span>
            );
          })}
        </nav>
      ) : (
        <div className="min-w-0 flex-1" />
      )}
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
      className="min-w-0"
    >
      {children}
    </section>
  );
}

function ChunkEntities({
  chunk,
}: {
  readonly chunk: ParsedChunkView;
}): ReactNode {
  const entities = parsedChunkCardModel.getEntityTags(chunk);
  if (entities.length === 0) return null;

  return (
    <section
      data-testid={`chunk-entities-panel-${chunk.chunkId}`}
    >
      <SectionLabel
        icon={<Link2 className="size-3.5" />}
        label="Entities"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entities.map((entity) => (
          <Badge
            key={entity.text}
            variant="outline"
            className={entityBadgeClassName}
            title={entity.type ?? undefined}
          >
            {entity.text}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function SectionLabel({
  icon,
  label,
}: {
  readonly icon: ReactNode;
  readonly label: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {label}
    </div>
  );
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
      <ChunkContentPanel chunk={chunk}>
        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground sm:text-sm">
          {renderTextChunkContent(chunk, onReferenceClick)}
        </pre>
      </ChunkContentPanel>
      <ChunkEntities chunk={chunk} />
    </ChunkCardFrame>
  );
}

function PageChunkCard({
  chunk,
  isFocused,
  focusedCitationId,
  focusedPageNumber,
  focusedPageRequestId,
  highlightRegions,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly focusedCitationId: string | null;
  readonly focusedPageNumber: number | null;
  readonly focusedPageRequestId: number;
  readonly highlightRegions: readonly ChatImageHighlightBox[];
}): ReactNode {
  const pageAssets = chunk.pageAssets ?? [];

  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
      {pageAssets.length > 0 ? (
        <ChunkContentPanel chunk={chunk}>
          <PageCitationAssets
            assets={pageAssets}
            focusedCitationId={focusedCitationId}
            focusedPageNumber={focusedPageNumber}
            focusedPageRequestId={focusedPageRequestId}
            highlightRegions={highlightRegions}
          />
        </ChunkContentPanel>
      ) : (
        <ChunkContentPanel chunk={chunk}>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground sm:text-sm">
            {chunk.readableContent ?? chunk.content}
          </p>
        </ChunkContentPanel>
      )}
      <ChunkEntities chunk={chunk} />
    </ChunkCardFrame>
  );
}

function PageCitationAssets({
  assets,
  focusedCitationId,
  focusedPageNumber,
  focusedPageRequestId,
  highlightRegions,
}: {
  readonly assets: NonNullable<ParsedChunkView["pageAssets"]>;
  readonly focusedCitationId: string | null;
  readonly focusedPageNumber: number | null;
  readonly focusedPageRequestId: number;
  readonly highlightRegions: readonly ChatImageHighlightBox[];
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {assets.map((asset) => (
        <PageCitationAssetImage
          key={asset.pageNumber}
          asset={asset}
          focusedCitationId={focusedCitationId}
          focusedPageRequestId={focusedPageRequestId}
          highlightRegions={highlightRegions}
          isCitationFocus={
            focusedCitationId !== null &&
            focusedPageNumber === asset.pageNumber
          }
        />
      ))}
    </div>
  );
}

function PageCitationAssetImage({
  asset,
  focusedCitationId,
  focusedPageRequestId,
  highlightRegions,
  isCitationFocus,
}: {
  readonly asset: NonNullable<ParsedChunkView["pageAssets"]>[number];
  readonly focusedCitationId: string | null;
  readonly focusedPageRequestId: number;
  readonly highlightRegions: readonly ChatImageHighlightBox[];
  readonly isCitationFocus: boolean;
}): ReactNode {
  const [failedAssetUrl, setFailedAssetUrl] = useState<string | null>(null);
  const [loadedAssetUrl, setLoadedAssetUrl] = useState<string | null>(null);
  const imageAssetUrl = getInlineImageAssetUrl(asset.assetUrl);
  const hasImageError = failedAssetUrl === imageAssetUrl;
  const isImageLoaded = loadedAssetUrl === imageAssetUrl;

  return (
    <figure className="overflow-hidden">
      <div
        className="flex justify-center overflow-hidden"
        data-citation-page={asset.pageNumber}
        data-focused-citation-id={isCitationFocus ? focusedCitationId : undefined}
      >
        {hasImageError ? (
          <PageCitationAssetUnavailable pageNumber={asset.pageNumber} />
        ) : (
          <div
            className="relative inline-block max-w-full"
            data-testid="citation-image-stage"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Page assets can be short-lived Knowhere URLs outside Next image optimization. */}
            <img
              src={imageAssetUrl}
              alt={`Page ${asset.pageNumber}`}
              width={asset.width}
              height={asset.height}
              className="block h-auto max-h-[680px] max-w-full object-contain"
              loading="lazy"
              onError={() => setFailedAssetUrl(imageAssetUrl)}
              onLoad={() => setLoadedAssetUrl(imageAssetUrl)}
            />
            {isCitationFocus && isImageLoaded ? (
              <CitationRegionHighlight
                regions={highlightRegions}
                requestId={focusedPageRequestId}
              />
            ) : null}
          </div>
        )}
      </div>
    </figure>
  );
}

function PageCitationAssetUnavailable({
  pageNumber,
}: {
  readonly pageNumber: number;
}): ReactNode {
  return (
    <div
      data-testid={`page-asset-image-unavailable-${pageNumber}`}
      className="flex min-h-[220px] w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-background/80 text-muted-foreground">
        <ImageOff className="size-5" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        Page image unavailable.
      </p>
    </div>
  );
}

function ImageChunkCard({
  chunk,
  isFocused,
  focusedPageRequestId,
  highlightRegions,
  sourceOriginalFile,
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
  readonly focusedPageRequestId: number;
  readonly highlightRegions: readonly ChatImageHighlightBox[];
  readonly sourceOriginalFile: SourceOriginalFileView | null;
}): ReactNode {
  const [loadedAssetUrl, setLoadedAssetUrl] = useState<string | null>(null);
  const imageAssetUrl = getImageChunkAssetUrl(chunk, sourceOriginalFile);
  const inlineImageAssetUrl = imageAssetUrl
    ? getInlineImageAssetUrl(imageAssetUrl)
    : null;
  const isImageLoaded = loadedAssetUrl === inlineImageAssetUrl;

  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
      {inlineImageAssetUrl ? (
        <ChunkContentPanel chunk={chunk}>
          <figure className="overflow-hidden">
            <div className="flex justify-center">
              <div
                className="relative inline-block max-w-full"
                data-testid="citation-image-stage"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Parsed artifact dimensions are not known before render. */}
                <img
                  src={inlineImageAssetUrl}
                  alt={chunk.summary ?? "Image chunk"}
                  className="block h-auto max-h-[520px] max-w-full object-contain"
                  onLoad={() => setLoadedAssetUrl(inlineImageAssetUrl)}
                />
                {isFocused && isImageLoaded ? (
                  <CitationRegionHighlight
                    regions={highlightRegions}
                    requestId={focusedPageRequestId}
                  />
                ) : null}
              </div>
            </div>
          </figure>
        </ChunkContentPanel>
      ) : (
        <ChunkContentPanel chunk={chunk}>
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
        </ChunkContentPanel>
      )}
      <ChunkEntities chunk={chunk} />
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

function getInlineImageAssetUrl(assetUrl: string): string {
  if (!isNotebookBlobAssetUrl(assetUrl)) return assetUrl;

  return `/api/parsed-assets/inline?url=${encodeURIComponent(assetUrl)}`;
}

function isNotebookBlobAssetUrl(assetUrl: string): boolean {
  try {
    const url = new URL(assetUrl);
    if (!url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")) {
      return false;
    }

    const pathname = decodeURIComponent(url.pathname).toLowerCase();
    return (
      pathname.includes("/parsed-documents/") ||
      pathname.includes("/parsed-result/")
    );
  } catch {
    return false;
  }
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
}: {
  readonly chunk: ParsedChunkView;
  readonly isFocused: boolean;
}): ReactNode {
  const safeHtml = useMemo(
    () => parsedChunkCardModel.getSanitizedTableHtml(chunk.content),
    [chunk.content],
  );

  return (
    <ChunkCardFrame chunk={chunk} isFocused={isFocused}>
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
      <ChunkEntities chunk={chunk} />
    </ChunkCardFrame>
  );
}
