"use client";

import { type CSSProperties, type ReactElement } from "react";
import { type VirtualItem } from "@tanstack/react-virtual";
import { MessageCircle } from "lucide-react";

import { useChatMessageListWorkflow } from "@/components/chat-message-list-workflow";
import { chatPanelModel } from "@/components/chat-panel-model";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type {
  ChatCitationView,
  ChatMessageView,
} from "@/domains/chat/types";

type DisplayCitation = {
  readonly citation: ChatCitationView;
  readonly citationId: string;
  readonly label: string;
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

  return (
    <div className="flex min-w-0 flex-col items-start">
      <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-xs sm:max-w-[90%] sm:px-4 sm:py-3">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
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

function getTrimmedCitationField(value: string | undefined): string | null {
  const trimmedValue = value?.trim() ?? "";
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function joinCitationDisplayKeyParts(parts: readonly string[]): string {
  return parts
    .map((part: string): string => `${part.length}:${part}`)
    .join("|");
}
