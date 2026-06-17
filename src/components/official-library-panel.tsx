"use client";

import { type CSSProperties, type ReactElement, useMemo, useState } from "react";
import { Check, ChevronRight, FileText, Plus, RotateCcw } from "lucide-react";
import Image from "next/image";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  OfficialLibrarySourceView,
  SourceView,
} from "@/domains/sources/types";

type OfficialLibraryPanelProps = {
  readonly addingLibrarySourceIds?: readonly string[];
  readonly officialLibrarySources?: readonly OfficialLibrarySourceView[];
  readonly sources?: readonly SourceView[];
  readonly onBack?: () => void;
  readonly onOfficialLibrarySourceAdd?: (demoSourceId: string) => void;
};

type LibraryItem = {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly chunkCount?: number;
  readonly demoSourceId?: string;
  readonly librarySourceId: string;
  readonly mimeType: string;
  readonly isAdded: boolean;
  readonly sourceUrl: string;
  readonly status: "ready" | "planned";
  readonly title: string;
};

type LibraryCategory = {
  readonly backgroundImagePath: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly itemCount: number;
  readonly readyCount: number;
};

const officialLibraryAssetPaths = {
  categoryBackgrounds: {
    financialReports: "/images/official-library/financial-reports.svg",
    otherDocs: "/images/official-library/other-docs.svg",
    researchPapers: "/images/official-library/research-papers.svg",
    stemBooks: "/images/official-library/stem-books.svg",
  },
  pdfDocumentIcon: "/icons/official-library/pdf-document.svg",
} as const;

export function OfficialLibraryPanel({
  addingLibrarySourceIds = [],
  officialLibrarySources = [],
  sources = [],
  onBack,
  onOfficialLibrarySourceAdd,
}: OfficialLibraryPanelProps): ReactElement {
  const libraryItems = useMemo(
    () => getLibraryItems(sources, officialLibrarySources),
    [officialLibrarySources, sources],
  );
  const categories = useMemo(
    () => getLibraryCategories(libraryItems),
    [libraryItems],
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const resolvedCategoryId =
    selectedCategoryId !== null &&
    categories.some((category) => category.categoryId === selectedCategoryId)
      ? selectedCategoryId
      : null;
  const selectedCategory = categories.find(
    (category) => category.categoryId === resolvedCategoryId,
  );
  const visibleItems = resolvedCategoryId
    ? libraryItems.filter((item) => item.categoryId === resolvedCategoryId)
    : libraryItems;
  const addingLibrarySourceIdSet = new Set(addingLibrarySourceIds);

  return (
    <main
      data-testid="official-library-panel"
      className="z-0 flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <header className="flex h-24 shrink-0 items-center border-b border-border/70 px-6">
        <button
          type="button"
          aria-label="Back to sources"
          onClick={onBack}
          disabled={!onBack}
          className="-ml-1 mr-2 inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent"
        >
          <RotateCcw
            className="size-4"
            data-testid="official-library-back-icon"
          />
        </button>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Library
        </h2>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-12 py-10">
          <div className="mb-9 flex flex-wrap items-center gap-2 text-base text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setSelectedCategoryId(null)}
            >
              All
            </button>
            {selectedCategory ? (
              <>
                <ChevronRight className="size-4" />
                <span className="font-bold tracking-wide text-foreground">
                  {selectedCategory.categoryLabel}
                </span>
              </>
            ) : null}
          </div>

          {libraryItems.length === 0 ? (
            <EmptyLibraryState />
          ) : resolvedCategoryId === null ? (
            <OfficialLibraryCategoryGrid
              categories={categories}
              onCategorySelect={setSelectedCategoryId}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-14 gap-y-14">
              {visibleItems.map((item) => (
                <OfficialLibraryCard
                  key={item.librarySourceId}
                  isAdding={addingLibrarySourceIdSet.has(
                    item.demoSourceId ?? item.librarySourceId,
                  )}
                  item={item}
                  onAdd={
                    onOfficialLibrarySourceAdd && item.demoSourceId
                      ? () => onOfficialLibrarySourceAdd(item.demoSourceId!)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

function OfficialLibraryCategoryGrid({
  categories,
  onCategorySelect,
}: {
  readonly categories: readonly LibraryCategory[];
  readonly onCategorySelect: (categoryId: string) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-5">
      {categories.map((category) => (
        <button
          key={category.categoryId}
          type="button"
          aria-label={`Open ${category.categoryLabel}`}
          onClick={() => onCategorySelect(category.categoryId)}
          style={getCategoryCardBackgroundStyle(category.backgroundImagePath)}
          className="group relative flex aspect-[1.32] min-h-40 overflow-hidden rounded-md bg-cover bg-center p-5 text-left shadow-sm ring-1 ring-border/60 transition-transform hover:-translate-y-0.5 hover:ring-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground"
        >
          <span className="mt-auto flex w-full flex-col gap-1 text-white">
            <span className="text-lg font-bold leading-tight">
              {category.categoryLabel}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-white/75">
              {getCategoryStatusLabel(category)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function OfficialLibraryCard({
  isAdding,
  item,
  onAdd,
}: {
  readonly isAdding: boolean;
  readonly item: LibraryItem;
  readonly onAdd?: () => void;
}): ReactElement {
  const canAdd = item.status === "ready" && Boolean(onAdd) && !item.isAdded;

  return (
    <article className="group relative flex min-w-0 flex-col items-center rounded-sm p-3 text-center transition-colors hover:bg-muted/60">
      {item.isAdded ? (
        <span
          aria-label={`${item.title} already added`}
          className="absolute right-3 top-1 inline-flex h-6 items-center gap-1 rounded-md bg-primary/10 px-2 text-[11px] font-semibold text-primary"
        >
          <Check className="size-3" />
          Added
        </span>
      ) : (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!canAdd || isAdding}
                onClick={onAdd}
                className="absolute right-3 top-1 inline-flex size-6 items-center justify-center rounded-md bg-background/95 text-muted-foreground opacity-100 shadow-xs transition-opacity hover:bg-background hover:text-foreground focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 min-[1116px]:bg-transparent min-[1116px]:opacity-0 min-[1116px]:shadow-none min-[1116px]:group-hover:opacity-100"
                aria-label={`Add ${item.title} to sources`}
              >
                {isAdding ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Plus className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-zinc-950 text-white">
              add to sources
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <a
        aria-label={`Open ${item.title} PDF preview`}
        className="flex min-w-0 flex-col items-center rounded-sm focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2"
        href={item.sourceUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        <PdfFileIcon />
        <h3 className="mt-3 max-w-[132px] truncate text-sm font-bold text-foreground">
          {item.title}
        </h3>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {getLibraryMetadata(item)}
        </p>
      </a>
    </article>
  );
}

function PdfFileIcon(): ReactElement {
  return (
    <div
      className="relative h-[74px] w-[65px]"
      data-testid="official-library-pdf-icon"
    >
      <Image
        alt=""
        draggable={false}
        height={74}
        loading="eager"
        src={officialLibraryAssetPaths.pdfDocumentIcon}
        width={65}
        className="h-[74px] w-[65px] object-contain"
      />
    </div>
  );
}

function EmptyLibraryState(): ReactElement {
  return (
    <div className="flex h-80 flex-col items-center justify-center text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileText className="size-6" />
      </div>
      <p className="text-sm font-semibold text-foreground">
        No library files yet.
      </p>
    </div>
  );
}

function getLibraryItems(
  sources: readonly SourceView[],
  officialLibrarySources: readonly OfficialLibrarySourceView[],
): LibraryItem[] {
  const addedDemoSourceIdSet = new Set(
    sources
      .filter((source) => source.kind !== "demo")
      .flatMap((source) => (source.demoSourceId ? [source.demoSourceId] : [])),
  );
  const metadataByLibrarySourceId = new Map(
    officialLibrarySources.map((source) => [source.librarySourceId, source]),
  );
  const itemByLibrarySourceId = new Map<string, LibraryItem>();

  for (const source of officialLibrarySources) {
    itemByLibrarySourceId.set(source.librarySourceId, {
      categoryId: source.categoryId,
      categoryLabel: source.categoryLabel,
      chunkCount: source.chunkCount,
      demoSourceId: source.demoSourceId,
      isAdded:
        source.demoSourceId !== undefined &&
        addedDemoSourceIdSet.has(source.demoSourceId),
      librarySourceId: source.librarySourceId,
      mimeType: source.mimeType,
      sourceUrl: source.sourceUrl,
      status: source.status,
      title: source.title,
    });
  }

  for (const source of sources) {
    if (!source.officialLibrary) continue;

    const metadata = metadataByLibrarySourceId.get(
      source.officialLibrary.librarySourceId,
    );
    itemByLibrarySourceId.set(source.officialLibrary.librarySourceId, {
      categoryId: source.officialLibrary.categoryId,
      categoryLabel:
        metadata?.categoryLabel ??
        getCategoryLabel(source.officialLibrary.categoryId),
      chunkCount: source.chunkCount ?? metadata?.chunkCount,
      demoSourceId: source.demoSourceId ?? metadata?.demoSourceId,
      isAdded:
        (source.demoSourceId !== undefined &&
          addedDemoSourceIdSet.has(source.demoSourceId)) ||
        (metadata?.demoSourceId !== undefined &&
          addedDemoSourceIdSet.has(metadata.demoSourceId)),
      librarySourceId: source.officialLibrary.librarySourceId,
      mimeType: source.mimeType,
      sourceUrl: source.officialLibrary.sourceUrl,
      status: "ready",
      title: source.title,
    });
  }

  return Array.from(itemByLibrarySourceId.values()).sort((left, right) => {
    if (left.categoryLabel !== right.categoryLabel) {
      return left.categoryLabel.localeCompare(right.categoryLabel);
    }
    if (left.status !== right.status) return left.status === "ready" ? -1 : 1;
    return left.title.localeCompare(right.title);
  });
}

function getLibraryCategories(
  items: readonly LibraryItem[],
): readonly LibraryCategory[] {
  const categoryById = new Map<
    string,
    {
      readonly categoryLabel: string;
      itemCount: number;
      readyCount: number;
    }
  >();
  for (const item of items) {
    const currentCategory = categoryById.get(item.categoryId);
    if (currentCategory) {
      currentCategory.itemCount += 1;
      if (item.status === "ready") currentCategory.readyCount += 1;
      continue;
    }

    categoryById.set(item.categoryId, {
      categoryLabel: item.categoryLabel,
      itemCount: 1,
      readyCount: item.status === "ready" ? 1 : 0,
    });
  }

  return Array.from(categoryById.entries())
    .map(([categoryId, category]) => ({
      backgroundImagePath: getCategoryBackgroundImagePath(categoryId),
      categoryId,
      categoryLabel: category.categoryLabel,
      itemCount: category.itemCount,
      readyCount: category.readyCount,
    }))
    .sort((left, right) => {
      const orderDiff =
        getCategorySortOrder(left.categoryId) -
        getCategorySortOrder(right.categoryId);
      if (orderDiff !== 0) return orderDiff;

      return left.categoryLabel.localeCompare(right.categoryLabel);
    });
}

function getCategoryLabel(categoryId: string): string {
  return categoryId
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getLibraryMetadata(item: LibraryItem): string {
  if (item.status !== "ready") return "Preparing";
  if (item.chunkCount !== undefined) return `${item.chunkCount} chunks`;

  return item.mimeType.includes("pdf") ? "PDF" : item.mimeType;
}

function getCategoryBackgroundImagePath(categoryId: string): string {
  const normalizedCategoryId = categoryId.toLowerCase();
  if (normalizedCategoryId.includes("financial")) {
    return officialLibraryAssetPaths.categoryBackgrounds.financialReports;
  }
  if (normalizedCategoryId.includes("research")) {
    return officialLibraryAssetPaths.categoryBackgrounds.researchPapers;
  }
  if (normalizedCategoryId.includes("stem")) {
    return officialLibraryAssetPaths.categoryBackgrounds.stemBooks;
  }

  return officialLibraryAssetPaths.categoryBackgrounds.otherDocs;
}

function getCategoryCardBackgroundStyle(
  backgroundImagePath: string,
): CSSProperties {
  return {
    backgroundImage:
      `linear-gradient(180deg, rgba(10, 10, 12, 0.08) 0%, rgba(10, 10, 12, 0.76) 100%), url("${backgroundImagePath}")`,
  };
}

function getCategorySortOrder(categoryId: string): number {
  const normalizedCategoryId = categoryId.toLowerCase();
  if (normalizedCategoryId.includes("financial")) return 0;
  if (normalizedCategoryId.includes("research")) return 1;
  if (normalizedCategoryId.includes("stem")) return 2;
  return 3;
}

function getCategoryStatusLabel(category: LibraryCategory): string {
  if (category.readyCount === category.itemCount) {
    return `${category.itemCount} ready`;
  }

  return `${category.readyCount}/${category.itemCount} ready`;
}
