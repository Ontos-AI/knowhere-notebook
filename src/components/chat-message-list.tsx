"use client";

import { type CSSProperties, type ReactElement } from "react";
import { type VirtualItem } from "@tanstack/react-virtual";
import { Copy, Download, FileText, ImageIcon, MessageCircle } from "lucide-react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { chatCitationModel } from "@/components/chat-citation-model";
import { ChatDiagramCard } from "@/components/chat-diagram-card";
import { useChatMessageListWorkflow } from "@/components/chat-message-list-workflow";
import { chatPanelModel } from "@/components/chat-panel-model";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatDiagramChartSpec } from "@/domains/chat/diagram";
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatMessageView,
} from "@/domains/chat/types";

type DisplayImageCitation = {
  readonly citation: ChatCitationView;
  readonly citationId: string;
  readonly label: string;
  readonly tooltipLabel: string;
  readonly assetUrl: string;
};

type DisplayImageArtifact = {
  readonly assetUrl: string;
  readonly citationId: string;
  readonly label: string;
};

type DisplayDerivedTableArtifact = {
  readonly artifactId: string;
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

export type ChatDiagramState =
  | {
      readonly status: "idle";
    }
  | {
      readonly status: "loading";
    }
  | {
      readonly status: "ready";
      readonly diagram: ChatDiagramChartSpec;
    }
  | {
      readonly status: "empty";
      readonly reason: string;
    }
  | {
      readonly status: "error";
      readonly message: string;
    };

const idleDiagramState: ChatDiagramState = { status: "idle" };

const assistantMarkdownComponents: Components = {
  p: ({ children }) => (
    <p className="whitespace-pre-wrap break-words">{children}</p>
  ),
};

export type ChatMessageListProps = {
  readonly diagramStatesByMessageId?: Readonly<Record<string, ChatDiagramState>>;
  readonly isDisabled?: boolean;
  readonly isSending?: boolean;
  readonly messages?: readonly ChatMessageView[];
  readonly needsLogin?: boolean;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
  readonly pendingCitationId?: string | null;
  readonly pendingStatusText?: string | null;
  readonly sourceTitlesByDocumentId?: Readonly<Record<string, string>>;
};

export function ChatMessageList({
  diagramStatesByMessageId = {},
  isDisabled = false,
  isSending = false,
  messages = [],
  needsLogin = false,
  onCitationClick,
  pendingCitationId = null,
  pendingStatusText = null,
  sourceTitlesByDocumentId = {},
}: ChatMessageListProps): ReactElement {
  const {
    getVirtualMessage,
    isThinkingVirtualItem,
    measureElement,
    messageRowCount,
    totalHeight,
    viewportRef,
    virtualItems,
  } = useChatMessageListWorkflow({ isSending, messages });

  return (
    <ScrollArea
      data-testid="chat-scroll"
      className="flex min-w-0 flex-1 flex-col overflow-x-hidden p-3 sm:p-4"
      viewportRef={viewportRef}
    >
      {messageRowCount === 0 ? (
        <EmptyChat disabled={isDisabled} needsLogin={needsLogin} />
      ) : (
        <div className="relative mt-auto min-w-0" style={{ height: totalHeight }}>
          {virtualItems.map((virtualItem) =>
            isThinkingVirtualItem(virtualItem) ? (
              <VirtualThinkingRow
                key={virtualItem.key}
                virtualItem={virtualItem}
                measureElement={measureElement}
                pendingStatusText={pendingStatusText}
              />
            ) : (
              <VirtualMessageRow
                key={virtualItem.key}
                virtualItem={virtualItem}
                message={getVirtualMessage(virtualItem)}
                measureElement={measureElement}
                diagramState={
                  diagramStatesByMessageId[getVirtualMessage(virtualItem)?.id ?? ""]
                }
                onCitationClick={onCitationClick}
                pendingCitationId={pendingCitationId}
                sourceTitlesByDocumentId={sourceTitlesByDocumentId}
              />
            ),
          )}
        </div>
      )}
    </ScrollArea>
  );
}

function VirtualThinkingRow({
  virtualItem,
  measureElement,
  pendingStatusText,
}: {
  readonly virtualItem: VirtualItem;
  readonly measureElement: (node: HTMLDivElement | null) => void;
  readonly pendingStatusText?: string | null;
}): ReactElement {
  const rowStyle: CSSProperties = {
    position: "absolute",
    transform: `translateY(${virtualItem.start}px)`,
    width: "100%",
  };

  return (
    <div
      ref={measureElement}
      data-index={virtualItem.index}
      style={rowStyle}
      className="min-w-0 pb-4 sm:pb-5"
    >
      <ThinkingProgressBubble pendingStatusText={pendingStatusText} />
    </div>
  );
}

function ThinkingProgressBubble({
  pendingStatusText,
}: {
  readonly pendingStatusText?: string | null;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col items-start">
      <div
        role="status"
        aria-label="Thinking"
        className="inline-flex max-w-[92%] items-center gap-2 rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2.5 text-sm text-muted-foreground shadow-xs sm:max-w-[90%] sm:px-4 sm:py-3"
      >
        <span className="font-medium text-foreground">
          {pendingStatusText ?? "Thinking"}
        </span>
        <span aria-hidden="true" className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-primary/60 animate-pulse" />
          <span className="size-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:150ms]" />
          <span className="size-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  );
}

function VirtualMessageRow({
  diagramState,
  virtualItem,
  message,
  measureElement,
  onCitationClick,
  pendingCitationId,
  sourceTitlesByDocumentId,
}: {
  readonly diagramState?: ChatDiagramState;
  readonly virtualItem: VirtualItem;
  readonly message: ChatMessageView | undefined;
  readonly measureElement: (node: HTMLDivElement | null) => void;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
  readonly pendingCitationId?: string | null;
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>;
}): ReactElement | null {
  if (!message) {
    return null;
  }

  const rowStyle: CSSProperties = {
    position: "absolute",
    transform: `translateY(${virtualItem.start}px)`,
    width: "100%",
  };

  return (
    <div
      ref={measureElement}
      data-index={virtualItem.index}
      style={rowStyle}
      className="min-w-0 pb-4 sm:pb-5"
    >
      <MessageBubble
        diagramState={diagramState ?? idleDiagramState}
        message={message}
        onCitationClick={onCitationClick}
        pendingCitationId={pendingCitationId}
        sourceTitlesByDocumentId={sourceTitlesByDocumentId}
      />
    </div>
  );
}

function EmptyChat({
  disabled,
  needsLogin,
}: {
  readonly disabled: boolean;
  readonly needsLogin: boolean;
}): ReactElement {
  return (
    <div className="m-auto mt-16 flex h-full w-full max-w-sm flex-col items-center justify-center px-3 pb-8 text-center sm:mt-24 sm:px-4 sm:pb-10">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-background text-primary/50 shadow-xs">
        <MessageCircle className="size-7" />
      </div>
      <h3 className="mb-1.5 text-sm font-bold text-foreground">
        How may I assist you today?
      </h3>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {needsLogin
            ? "Log in to start asking questions about your sources."
            : disabled
            ? "Add a ready source to start asking questions."
            : "Ask anything about your sources. Answers include source links when Notebook finds support."}
      </p>
    </div>
  );
}

function MessageBubble({
  diagramState,
  message,
  onCitationClick,
  pendingCitationId,
  sourceTitlesByDocumentId,
}: {
  readonly diagramState: ChatDiagramState;
  readonly message: ChatMessageView;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
  readonly pendingCitationId?: string | null;
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>;
}): ReactElement {
  if (message.role === "user") {
    return (
      <div className="flex min-w-0 flex-col items-end">
        <div className="max-w-[85%] break-words rounded-2xl rounded-tr-sm bg-muted px-3 py-2.5 text-sm text-foreground shadow-xs sm:px-4 sm:py-3">
          {message.content}
        </div>
      </div>
    );
  }

  const displayImageArtifacts = getDisplayImageArtifacts(
    message,
    sourceTitlesByDocumentId,
  );
  const displayImageCitations =
    message.artifacts !== undefined
      ? displayImageArtifacts
      : getDisplayImageCitations(message, sourceTitlesByDocumentId);
  const displayDerivedTables = getDisplayDerivedTableArtifacts(message);
  const citationContentMarkdown = chatCitationModel.embedCitationMarkersAsLinks(
    message.content,
    message.citations ?? [],
    sourceTitlesByDocumentId,
  );

  return (
    <div className="flex min-w-0 flex-col items-start">
      <TooltipProvider delayDuration={0}>
      <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-xs sm:max-w-[90%] sm:px-4 sm:py-3">
        <AssistantMessageContent
          content={citationContentMarkdown}
          message={message}
          onCitationClick={onCitationClick}
          pendingCitationId={pendingCitationId}
          sourceTitlesByDocumentId={sourceTitlesByDocumentId}
        />
        {displayDerivedTables.length > 0 && (
          <div className="mt-3 space-y-3 border-t border-border/70 pt-2.5">
            {displayDerivedTables.map((artifact) => (
              <DerivedTableArtifactView
                key={artifact.artifactId}
                artifact={artifact}
              />
            ))}
          </div>
        )}
        <AssistantDiagram state={diagramState} />
        {displayImageCitations.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-2.5">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <ImageIcon className="size-3" />
              Images
            </p>
            <div className="grid gap-2">
              {displayImageCitations.map(({ assetUrl, citationId, label }) => (
                <figure
                  key={`${citationId}-image`}
                  className="overflow-hidden rounded-lg border border-border bg-muted/25"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Chat image citation dimensions are not known before render. */}
                  <img
                    src={assetUrl}
                    alt={label}
                    className="max-h-64 w-full object-contain"
                  />
                  <figcaption className="border-t border-border/70 bg-background/80 px-2.5 py-2">
                    <span className="block break-words text-[11px] font-semibold text-foreground">
                      {label}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
        <AssistantSources
          message={message}
          onCitationClick={onCitationClick}
          pendingCitationId={pendingCitationId}
          sourceTitlesByDocumentId={sourceTitlesByDocumentId}
        />
      </div>
      </TooltipProvider>
      <AssistantMessageActions
        message={message}
        sourceTitlesByDocumentId={sourceTitlesByDocumentId}
      />
    </div>
  );
}

function AssistantDiagram({
  state,
}: {
  readonly state: ChatDiagramState;
}): ReactElement | null {
  if (state.status === "idle") return null;

  return (
    <div className="mt-3 border-t border-border/70 pt-2.5">
      {state.status === "loading" && (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
        >
          <Spinner className="size-3.5" />
          <span>Creating diagram</span>
        </div>
      )}
      {state.status === "ready" && (
        <ChatDiagramCard diagram={state.diagram} />
      )}
      {state.status === "empty" && (
        <div className="rounded-md border border-dashed border-border/80 bg-muted/35 px-3 py-2.5">
          <p className="text-xs font-semibold text-foreground">
            No diagram created
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {state.reason}
          </p>
        </div>
      )}
      {state.status === "error" && (
        <p className="mt-2 text-xs text-destructive">{state.message}</p>
      )}
    </div>
  );
}

function DerivedTableArtifactView({
  artifact,
}: {
  readonly artifact: DisplayDerivedTableArtifact;
}): ReactElement {
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border border-border bg-background/80">
      <figcaption className="border-b border-border/70 px-2.5 py-2 text-[11px] font-bold text-foreground">
        {artifact.title}
      </figcaption>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left text-[12px] leading-normal">
          <thead className="bg-muted/60 text-[11px] font-bold uppercase text-muted-foreground">
            <tr>
              {artifact.columns.map((column, index) => (
                <th
                  key={`${artifact.artifactId}:column:${index}`}
                  scope="col"
                  className="border-b border-border px-2.5 py-2"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, rowIndex) => (
              <tr
                key={`${artifact.artifactId}:row:${rowIndex}`}
                className="odd:bg-background even:bg-muted/20"
              >
                {artifact.columns.map((_, columnIndex) => (
                  <td
                    key={`${artifact.artifactId}:row:${rowIndex}:cell:${columnIndex}`}
                    className="border-b border-border/70 px-2.5 py-2 align-top text-foreground"
                  >
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function AssistantMessageContent({
  content,
  message,
  onCitationClick,
  pendingCitationId,
  sourceTitlesByDocumentId,
}: {
  readonly content: string;
  readonly message: ChatMessageView;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
  readonly pendingCitationId?: string | null;
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>;
}): ReactElement {
  const markdownComponents: Components = {
    ...assistantMarkdownComponents,
    a: ({ href, children }) => {
      const citationIndex = chatCitationModel.parseKnowhereCiteIndex(href);
      if (citationIndex !== null) {
        const citation = (message.citations ?? [])[citationIndex - 1];
        if (!citation) return null;
        const citationId = chatPanelModel.getCitationId(
          message.id,
          citationIndex - 1,
        );
        return (
          <CitationChip
            citation={citation}
            citationId={citationId}
            isPending={citationId === pendingCitationId}
            label={chatCitationModel.getCitationChipLabel(
              citation,
              sourceTitlesByDocumentId,
            )}
            onCitationClick={onCitationClick}
            tooltipLabel={chatPanelModel.getCitationLabel(
              citation,
              sourceTitlesByDocumentId,
            )}
          />
        );
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary underline decoration-primary/40 underline-offset-4 hover:text-primary/80"
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className="chat-markdown-content min-w-0 max-w-full overflow-x-auto">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={transformAssistantMarkdownUrl}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AssistantSources({
  message,
  onCitationClick,
  pendingCitationId,
  sourceTitlesByDocumentId,
}: {
  readonly message: ChatMessageView;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
  readonly pendingCitationId?: string | null;
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>;
}): ReactElement | null {
  const groups = chatCitationModel.groupCitationsByFile(
    message.id,
    message.citations ?? [],
    sourceTitlesByDocumentId,
  );
  if (groups.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border/70 pt-2.5">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Sources
      </p>
      <TooltipProvider delayDuration={0}>
        <ol className="space-y-1.5 text-xs leading-5 text-foreground">
          {groups.map((group, groupIndex) => (
            <li
              key={group.key}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"
            >
              <span className="font-semibold text-muted-foreground">
                {groupIndex + 1}.
              </span>
              <CitationSourceTitle
                group={group}
                isPending={group.entries.some(
                  (entry) => entry.citationId === pendingCitationId,
                )}
                onCitationClick={onCitationClick}
              />
              {chatCitationModel.uniquePageLinkEntries(group.entries).map(
                (entry) => (
                  <button
                    key={entry.citationId}
                    type="button"
                    data-testid="citation-source-page"
                    disabled={
                      !onCitationClick || entry.citationId === pendingCitationId
                    }
                    onClick={() =>
                      onCitationClick?.(entry.citation, entry.citationId)
                    }
                    aria-busy={entry.citationId === pendingCitationId}
                    aria-label={`Open page ${entry.pageNumber} of ${group.title}`}
                    className="text-[13px] font-medium text-primary hover:underline disabled:cursor-wait disabled:no-underline disabled:opacity-75"
                  >
                    p{entry.pageNumber}
                  </button>
                ),
              )}
            </li>
          ))}
        </ol>
      </TooltipProvider>
    </div>
  );
}

function CitationSourceTitle({
  group,
  isPending,
  onCitationClick,
}: {
  readonly group: ReturnType<typeof chatCitationModel.groupCitationsByFile>[number];
  readonly isPending: boolean;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
}): ReactElement {
  const firstEntry = group.entries[0];
  if (!firstEntry) {
    return <span className="min-w-0 break-words font-semibold">{group.title}</span>;
  }

  return (
    <button
      type="button"
      disabled={!onCitationClick || isPending}
      onClick={() => onCitationClick?.(firstEntry.citation, firstEntry.citationId)}
      aria-busy={isPending}
      aria-label={`Open source ${group.title}`}
      className="min-w-0 break-words text-left font-medium text-foreground hover:text-primary disabled:cursor-wait disabled:opacity-75"
    >
      {group.title}
    </button>
  );
}

function AssistantMessageActions({
  message,
  sourceTitlesByDocumentId,
}: {
  readonly message: ChatMessageView;
  readonly sourceTitlesByDocumentId: Readonly<Record<string, string>>;
}): ReactElement {
  const copyMarkdown = chatCitationModel.getCopyMarkdown(
    message,
    sourceTitlesByDocumentId,
  );
  const exportMarkdown = chatCitationModel.getExportMarkdown(message);

  return (
    <div className="mt-1.5 flex items-center gap-0.5 text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Copy answer"
        onClick={() => {
          void navigator.clipboard.writeText(copyMarkdown);
        }}
      >
        <Copy className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Download answer as Markdown"
        onClick={() => downloadTextFile("knowhere-brain-answer.md", exportMarkdown)}
      >
        <FileText className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Download answer as PDF"
        onClick={() => {
          void import("./chat-message-export-pdf").then(({ downloadAnswerPdf }) =>
            downloadAnswerPdf("knowhere-brain-answer.pdf", exportMarkdown),
          );
        }}
      >
        <Download className="size-3.5" />
      </Button>
    </div>
  );
}

function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function transformAssistantMarkdownUrl(value: string): string {
  return chatCitationModel.transformMarkdownUrl(value, defaultUrlTransform);
}

function CitationChip({
  citation,
  citationId,
  isPending,
  label,
  onCitationClick,
  tooltipLabel,
}: {
  readonly citation: ChatCitationView;
  readonly citationId: string;
  readonly isPending: boolean;
  readonly label: string;
  readonly tooltipLabel: string;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
}): ReactElement {
  return (
    <span className="mx-0.5 inline-flex max-w-[250px] align-middle">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="citation-chip"
            data-citation-id={citationId}
            disabled={!onCitationClick || isPending}
            onClick={() => onCitationClick?.(citation, citationId)}
            aria-busy={isPending}
            className="inline-flex h-5 max-w-[250px] cursor-pointer items-center rounded-[4px] bg-muted px-1.5 text-left font-mono text-[11px] font-medium leading-none text-muted-foreground transition-colors hover:bg-accent-dark hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-75"
            aria-label={`Open source ${label}`}
          >
            <span className="min-w-0 truncate">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-[320px] bg-popover text-popover-foreground shadow-lg"
        >
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

function getDisplayImageCitations(
  message: ChatMessageView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): readonly DisplayImageCitation[] {
  const seenAssetUrls = new Set<string>();
  const imageCitations: DisplayImageCitation[] = [];

  for (const [index, citation] of (message.citations ?? []).entries()) {
    const assetUrl = getTrimmedCitationField(citation.assetUrl);
    if (!assetUrl || !isImageCitation(citation, assetUrl)) continue;
    if (seenAssetUrls.has(assetUrl)) continue;

    seenAssetUrls.add(assetUrl);
    const label = chatPanelModel.getCitationLabel(
      citation,
      sourceTitlesByDocumentId,
    );
    imageCitations.push({
      citation,
      citationId: chatPanelModel.getCitationId(message.id, index),
      label,
      tooltipLabel: label,
      assetUrl,
    });
  }

  return imageCitations;
}

function getDisplayImageArtifacts(
  message: ChatMessageView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): readonly DisplayImageArtifact[] {
  const seenAssetUrls = new Set<string>();
  const imageArtifacts: DisplayImageArtifact[] = [];

  for (const [index, artifact] of (message.artifacts ?? []).entries()) {
    if (artifact.display === false || artifact.type !== "image") continue;

    const assetUrl = getTrimmedCitationField(artifact.assetUrl);
    if (!assetUrl || seenAssetUrls.has(assetUrl)) continue;

    seenAssetUrls.add(assetUrl);
    imageArtifacts.push({
      assetUrl,
      citationId: `${message.id}:artifact:${index}`,
      label: getArtifactLabel(artifact, sourceTitlesByDocumentId),
    });
  }

  return imageArtifacts;
}

function getDisplayDerivedTableArtifacts(
  message: ChatMessageView,
): readonly DisplayDerivedTableArtifact[] {
  const tables: DisplayDerivedTableArtifact[] = [];

  for (const [index, artifact] of (message.artifacts ?? []).entries()) {
    if (artifact.display === false || artifact.type !== "derived_table") continue;
    if (!artifact.title || !artifact.columns || !artifact.rows) continue;

    tables.push({
      artifactId: `${message.id}:derived-table:${index}`,
      title: artifact.title,
      columns: artifact.columns,
      rows: artifact.rows,
    });
  }

  return tables;
}

function getArtifactLabel(
  artifact: ChatArtifactView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  const label = getTrimmedCitationField(artifact.label);
  if (label) return label;

  if (artifact.citation) {
    return chatPanelModel.getCitationLabel(
      artifact.citation,
      sourceTitlesByDocumentId,
    );
  }

  return getTrimmedCitationField(artifact.reason) ?? "Selected image";
}

function isImageCitation(
  citation: ChatCitationView,
  assetUrl: string,
): boolean {
  return (
    citation.chunkType.toLowerCase() === "image" ||
    hasImageFileExtension(assetUrl)
  );
}

function hasImageFileExtension(assetUrl: string): boolean {
  const pathname = getUrlPathname(assetUrl).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].some(
    (extension) => pathname.endsWith(extension),
  );
}

function getUrlPathname(assetUrl: string): string {
  try {
    return new URL(assetUrl).pathname;
  } catch {
    return assetUrl.split("?")[0] ?? assetUrl;
  }
}

function getTrimmedCitationField(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? "";
  return trimmedValue.length > 0 ? trimmedValue : null;
}
