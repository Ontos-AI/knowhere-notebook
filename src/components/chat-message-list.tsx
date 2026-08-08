"use client";

import { type CSSProperties, type ReactElement } from "react";
import { type VirtualItem } from "@tanstack/react-virtual";
import { ImageIcon, MessageCircle } from "lucide-react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { ChatDiagramCard } from "@/components/chat-diagram-card";
import { useChatMessageListWorkflow } from "@/components/chat-message-list-workflow";
import { CollapsibleSection } from "@/components/collapsible-section";
import { ChatRetrievalTrace } from "@/components/chat-retrieval-trace";
import { chatPanelModel } from "@/components/chat-panel-model";
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

type DisplayCitation = {
  readonly citation: ChatCitationView;
  readonly citationId: string;
  readonly label: string;
  readonly tooltipLabel: string;
};

type DisplayImageCitation = DisplayCitation & {
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

  const displayCitations = getDisplayCitations(
    message,
    sourceTitlesByDocumentId,
  );
  const displayImageArtifacts = getDisplayImageArtifacts(
    message,
    sourceTitlesByDocumentId,
  );
  const displayImageCitations =
    message.artifacts !== undefined
      ? displayImageArtifacts
      : getDisplayImageCitations(message, sourceTitlesByDocumentId);
  const displayDerivedTables = getDisplayDerivedTableArtifacts(message);
  const citationContentMarkdown = buildCitationContentMarkdown(
    message.content,
    message.citations ?? [],
    sourceTitlesByDocumentId,
    message.id,
  );

  return (
    <div className="flex min-w-0 flex-col items-start">
      <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-xs sm:max-w-[90%] sm:px-4 sm:py-3">
        <AssistantMessageContent
          content={citationContentMarkdown}
          citations={message.citations ?? []}
          messageId={message.id}
          onCitationClick={onCitationClick}
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
          displayCitations={displayCitations}
          onCitationClick={onCitationClick}
          pendingCitationId={pendingCitationId}
        />
        {message.retrievalTrace && (
          <ChatRetrievalTrace trace={message.retrievalTrace} />
        )}
      </div>
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

function buildCitationContentMarkdown(
  content: string,
  citations: readonly ChatCitationView[],
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
  messageId: string,
): string {
  // Replace matched inline markers with links keyed by a private citation
  // index href (`#citation-index-N`), then rewrite to the real citation id
  // (`#citation-<messageId>:<index>`) in a second pass. The two-pass form
  // keeps a later token from matching inside a link produced earlier.
  let rewrittenContent = content;
  const matchedIndexes = new Set<number>();

  for (const [index, citation] of citations.entries()) {
    const displayCitation = {
      citation,
      citationId: "",
      label: getCitationSourceChipLabel(citation, sourceTitlesByDocumentId),
      tooltipLabel: chatPanelModel.getCitationLabel(
        citation,
        sourceTitlesByDocumentId,
      ),
    };
    for (const token of getInlineCitationTokens(displayCitation, index)) {
      if (!rewrittenContent.includes(token)) continue;

      matchedIndexes.add(index);
      // Superscript-style [n] link (n = citation number) — the prose stays
      // clean while the marker stays clickable.
      rewrittenContent = replaceInlineCitationToken(
        rewrittenContent,
        token,
        index + 1,
        `citation-index-${index}`,
      );
    }
  }

  if (matchedIndexes.size === 0) return rewrittenContent;

  for (const index of matchedIndexes) {
    const citationId = chatPanelModel.getCitationId(messageId, index);
    rewrittenContent = rewrittenContent.replaceAll(
      `#citation-index-${index}`,
      `#citation-${citationId}`,
    );
  }

  return rewrittenContent;
}

function replaceInlineCitationToken(
  content: string,
  token: string,
  citationNumber: number,
  href: string,
): string {
  const link = `[${citationNumber}](#${href})`;
  return content
    .replaceAll(` ${token}`, ` ${link}`)
    .replaceAll(`${token} `, `${link} `)
    .replaceAll(token, link);
}

function getInlineCitationTokens(
  displayCitation: DisplayCitation,
  index: number,
): readonly string[] {
  const label = displayCitation.label;
  const slashLabel = label.replace(/\s+·\s+/gu, " / ");
  const sourceName = getCitationSourceName(label);
  const sectionPath = getTrimmedCitationField(
    displayCitation.citation.source.sectionPath,
  );
  const description = getTrimmedCitationField(displayCitation.citation.description);
  const sectionLabel = sectionPath ? `${sourceName} / ${sectionPath}` : null;
  const descriptionLabel = description ? `${sourceName} / ${description}` : null;
  const citationNumber = index + 1;
  const tokens = [
    `[${label}]`,
    `[${slashLabel}]`,
    `[Source ${citationNumber}: ${label}]`,
    `[Source ${citationNumber}: ${slashLabel}]`,
    sectionLabel ? `[${sectionLabel}]` : null,
    sectionLabel ? `[Source ${citationNumber}: ${sectionLabel}]` : null,
    descriptionLabel ? `[${descriptionLabel}]` : null,
    descriptionLabel ? `[Source ${citationNumber}: ${descriptionLabel}]` : null,
    description ? `[${description}]` : null,
    description ? `[Source ${citationNumber}: ${description}]` : null,
  ];

  return Array.from(
    new Set(tokens.filter((token): token is string => Boolean(token))),
  ).sort((left, right): number => right.length - left.length);
}

function getCitationSourceName(label: string): string {
  const [sourceName] = label.split(/\s+·\s+/u);
  const normalized = sourceName?.trim();
  return normalized && normalized.length > 0 ? normalized : label;
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
  citations = [],
  messageId,
  onCitationClick,
}: {
  readonly content: string;
  readonly citations?: readonly ChatCitationView[];
  readonly messageId?: string;
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
}): ReactElement {
  const markdownComponents: Components = {
    ...assistantMarkdownComponents,
    a: ({ href, children }) => {
      // Inline citation links (`#citation-<messageId>:<index>`) open the
      // same chunk pane flow as the citation chips below the answer.
      const citationId = extractCitationAnchorId(href);
      const citation = getCitationById(
        citations,
        messageId,
        citationId,
      );
      if (citationId && citation && onCitationClick) {
        return (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onCitationClick(citation, citationId);
            }}
            className="mx-0.5 inline-block cursor-pointer rounded-sm px-1 text-[10px] font-bold leading-none text-primary underline decoration-primary/40 underline-offset-2 hover:bg-primary/10"
            aria-label={`Open referenced chunk ${citationId}`}
            title="Open referenced chunk"
          >
            {children}
          </button>
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

function extractCitationAnchorId(href: string | undefined): string | null {
  if (!href || !href.startsWith("#citation-")) return null;
  return href.slice("#citation-".length);
}

function getCitationById(
  citations: readonly ChatCitationView[],
  messageId: string | undefined,
  citationId: string | null,
): ChatCitationView | undefined {
  if (!messageId || !citationId) return undefined;
  const [matchedMessageId, indexText] = citationId.split(":");
  if (matchedMessageId !== messageId) return undefined;
  const index = Number(indexText);
  if (!Number.isInteger(index)) return undefined;
  return citations[index];
}

function AssistantSources({
  displayCitations,
  onCitationClick,
  pendingCitationId,
}: {
  readonly displayCitations: readonly DisplayCitation[];
  readonly onCitationClick?: (
    citation: ChatCitationView,
    citationId: string,
  ) => void;
  readonly pendingCitationId?: string | null;
}): ReactElement | null {
  if (displayCitations.length === 0) return null;

  return (
    <CollapsibleSection title="Sources" badge={displayCitations.length}>
      <TooltipProvider delayDuration={0}>
        <div className="flex flex-wrap gap-1.5">
          {displayCitations.map((displayCitation) => (
            <CitationChip
              key={displayCitation.citationId}
              citation={displayCitation.citation}
              citationId={displayCitation.citationId}
              label={displayCitation.label}
              tooltipLabel={displayCitation.tooltipLabel}
              isPending={displayCitation.citationId === pendingCitationId}
              onCitationClick={onCitationClick}
            />
          ))}
        </div>
      </TooltipProvider>
    </CollapsibleSection>
  );
}

function transformAssistantMarkdownUrl(value: string): string {
  return defaultUrlTransform(value);
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={!onCitationClick || isPending}
          onClick={() => onCitationClick?.(citation, citationId)}
          aria-busy={isPending}
          className="inline-flex h-8 max-w-[250px] cursor-pointer items-center rounded-md border border-primary/20 bg-primary/10 px-3 text-left font-mono text-xs font-semibold leading-none text-primary shadow-[0_1px_0_rgba(15,23,42,0.06)] transition-[background-color,border-color,color,box-shadow,transform] hover:border-primary/35 hover:bg-primary/15 hover:text-primary hover:shadow-[0_0_0_2px_rgba(37,99,235,0.12)] active:translate-y-px active:bg-primary/20 focus:outline-none focus:ring-4 focus:ring-ring/15 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-wait disabled:opacity-75 disabled:hover:border-primary/20 disabled:hover:bg-primary/10 disabled:hover:text-primary disabled:hover:shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:border-transparent dark:bg-[#5c606b] dark:text-[#cfd3dc] dark:shadow-none dark:hover:border-[#8f96a8] dark:hover:bg-[#4f535e] dark:hover:text-white dark:hover:shadow-[0_0_0_2px_rgba(143,150,168,0.22)] dark:active:bg-[#454955] dark:disabled:hover:border-transparent dark:disabled:hover:bg-[#5c606b] dark:disabled:hover:text-[#cfd3dc] dark:disabled:hover:shadow-none"
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
        <div>
          {tooltipLabel}
          {isUsableCitationScore(citation.score) && (
            <span className="mt-1 block text-[10px] font-semibold text-muted-foreground">
              Score: {citation.score!.toFixed(3)}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function isUsableCitationScore(score: number | null | undefined): boolean {
  return typeof score === "number" && Number.isFinite(score) && score > 0;
}

function getDisplayCitations(
  message: ChatMessageView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): readonly DisplayCitation[] {
  const seenKeys = new Set<string>();
  const displayCitations: DisplayCitation[] = [];

  for (const [index, citation] of (message.citations ?? []).entries()) {
    const label = getCitationSourceChipLabel(
      citation,
      sourceTitlesByDocumentId,
    );
    const key = getCitationDisplayKey(citation, label);
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    displayCitations.push({
      citation,
      citationId: chatPanelModel.getCitationId(message.id, index),
      label,
      tooltipLabel: chatPanelModel.getCitationLabel(
        citation,
        sourceTitlesByDocumentId,
      ),
    });
  }

  return displayCitations;
}

function getCitationSourceChipLabel(
  citation: ChatCitationView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): string {
  const documentId = getTrimmedCitationField(citation.source.documentId);
  const sourceTitle = documentId
    ? getTrimmedCitationField(sourceTitlesByDocumentId[documentId])
    : null;
  if (sourceTitle) return sourceTitle;

  const sourceFileName = getTrimmedCitationField(citation.source.sourceFileName);
  if (sourceFileName && !isGeneratedKnowhereFileName(sourceFileName)) {
    return sourceFileName;
  }

  return "Source";
}

function isGeneratedKnowhereFileName(value: string): boolean {
  return /^document-[A-Za-z0-9_-]{16,}\.[A-Za-z0-9]+$/u.test(value);
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

function getCitationDisplayKey(
  citation: ChatCitationView,
  label: string,
): string {
  const documentId = getTrimmedCitationField(citation.source.documentId);
  if (documentId) {
    return joinCitationDisplayKeyParts([
      "document",
      documentId,
      getMeaningfulCitationKeyField(citation.source.sectionPath) ?? "",
      getMeaningfulCitationKeyField(citation.description) ?? "",
      label,
    ]);
  }

  return joinCitationDisplayKeyParts([
    "fallback",
    getTrimmedCitationField(citation.source.sourceFileName) ?? "",
    getMeaningfulCitationKeyField(citation.source.sectionPath) ?? "",
    getMeaningfulCitationKeyField(citation.description) ?? "",
    label,
  ]);
}

function getMeaningfulCitationKeyField(value: string | null | undefined): string | null {
  const field = getTrimmedCitationField(value);
  if (!field || field === "Root" || isGeneratedKnowhereFileName(field)) return null;
  return field;
}

function getTrimmedCitationField(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? "";
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function joinCitationDisplayKeyParts(parts: readonly string[]): string {
  return parts
    .map((part: string): string => `${part.length}:${part}`)
    .join("|");
}
