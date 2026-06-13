"use client";

import { type CSSProperties, type ReactElement } from "react";
import { type VirtualItem } from "@tanstack/react-virtual";
import { ImageIcon, MessageCircle } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useChatMessageListWorkflow } from "@/components/chat-message-list-workflow";
import { chatPanelModel } from "@/components/chat-panel-model";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatMessageView,
} from "@/domains/chat/types";

type DisplayCitation = {
  readonly citation: ChatCitationView;
  readonly citationId: string;
  readonly label: string;
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

const assistantMarkdownComponents: Components = {
  p: ({ children }) => (
    <p className="whitespace-pre-wrap break-words">{children}</p>
  ),
};

export type ChatMessageListProps = {
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
  virtualItem,
  message,
  measureElement,
  onCitationClick,
  pendingCitationId,
  sourceTitlesByDocumentId,
}: {
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
            ? "Upload a document to start asking questions."
            : "Ask anything about your sources. Answers include source links when Notebook finds support."}
      </p>
    </div>
  );
}

function MessageBubble({
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

  return (
    <div className="flex min-w-0 flex-col items-start">
      <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-xs sm:max-w-[90%] sm:px-4 sm:py-3">
        <AssistantMessageContent content={message.content} />
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
        {displayCitations.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sources used
            </p>
            <div className="flex flex-wrap gap-1.5">
              {displayCitations.map(({ citation, citationId, label }) => {
                const isPending = citationId === pendingCitationId;

                return (
                  <button
                    key={citationId}
                    type="button"
                    disabled={!onCitationClick || isPending}
                    onClick={() => onCitationClick?.(citation, citationId)}
                    className="inline-flex max-w-full cursor-pointer items-center gap-1 whitespace-normal rounded-sm px-0.5 py-0 text-left text-[11px] font-semibold text-primary underline decoration-primary/45 underline-offset-4 transition-colors hover:text-primary/80 hover:decoration-primary focus:outline-none focus:ring-4 focus:ring-ring/15 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-wait disabled:opacity-75"
                    aria-label={`Open source ${label}`}
                  >
                    {isPending && <Spinner className="size-3" />}
                    <span className="min-w-0 break-words">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
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
}: {
  readonly content: string;
}): ReactElement {
  return (
    <div className="chat-markdown-content min-w-0 max-w-full overflow-x-auto">
      <ReactMarkdown
        components={assistantMarkdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function getDisplayCitations(
  message: ChatMessageView,
  sourceTitlesByDocumentId: Readonly<Record<string, string>>,
): readonly DisplayCitation[] {
  const seenKeys = new Set<string>();
  const displayCitations: DisplayCitation[] = [];

  for (const [index, citation] of (message.citations ?? []).entries()) {
    const label = chatPanelModel.getCitationLabel(
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
    });
  }

  return displayCitations;
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
    imageCitations.push({
      citation,
      citationId: chatPanelModel.getCitationId(message.id, index),
      label: chatPanelModel.getCitationLabel(citation, sourceTitlesByDocumentId),
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
    return joinCitationDisplayKeyParts(["document", documentId, label]);
  }

  return joinCitationDisplayKeyParts([
    "fallback",
    getTrimmedCitationField(citation.source.sourceFileName) ?? "",
    getTrimmedCitationField(citation.source.sectionPath) ?? "",
    getTrimmedCitationField(citation.description) ?? "",
    label,
  ]);
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
