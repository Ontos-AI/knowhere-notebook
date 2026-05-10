"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { History, MessageCircle, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
} from "@/lib/types";

const CHAT_COMPOSER_ID = "chat-composer";

export type ChatPanelProps = {
  messages: ChatMessageView[];
  threads: ChatThreadView[];
  activeThreadId?: string | null;
  onSend?: (text: string) => void;
  onNewChat?: () => void;
  onThreadSelect?: (threadId: string) => void;
  onThreadArchive?: (threadId: string) => void;
  onCitationClick?: (citation: ChatCitationView, citationId: string) => void;
  onLoginClick?: () => void;
  sourceCount?: number;
  isSending?: boolean;
  isHistoryLoading?: boolean;
  isCreatingThread?: boolean;
  loadingThreadId?: string | null;
  archivingThreadIds?: readonly string[];
  pendingCitationId?: string | null;
  isDisabled?: boolean;
};

const estimatedMessageHeight = 160;
const virtualMessageOverscan = 6;

export function ChatPanel({
  messages = [],
  threads = [],
  activeThreadId = null,
  onSend,
  onNewChat,
  onThreadSelect,
  onThreadArchive,
  onCitationClick,
  onLoginClick,
  sourceCount = 0,
  isSending = false,
  isHistoryLoading = false,
  isCreatingThread = false,
  loadingThreadId = null,
  archivingThreadIds = [],
  pendingCitationId = null,
  isDisabled = false,
}: Partial<ChatPanelProps> = {}) {
  const [input, setInput] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [confirmThreadId, setConfirmThreadId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canSend = !isDisabled && !isSending && input.trim().length > 0;
  const confirmThread = threads.find((thread) => thread.id === confirmThreadId);
  // TanStack Virtual owns scroll measurement callbacks; this component is not memoized by React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const messageVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimatedMessageHeight,
    overscan: virtualMessageOverscan,
  });
  const virtualItems = messageVirtualizer.getVirtualItems();
  const totalHeight = messageVirtualizer.getTotalSize();

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    messageVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messageVirtualizer, messages.length]);

  function handleSend() {
    if (!canSend) return;
    onSend?.(input.trim());
    setInput("");
  }

  function handleNewChat() {
    if (isCreatingThread) return;
    onNewChat?.();
    setIsHistoryOpen(false);
  }

  return (
    <section
      data-testid="chat-panel"
      className="relative z-0 flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden border-border/70 bg-muted/40 lg:border-l"
    >
      <AlertDialog
        open={confirmThreadId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmThreadId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmThread
                ? `Delete "${confirmThread.title}"? You can start a new chat any time.`
                : "Delete this chat? You can start a new chat any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmThreadId) {
                  onThreadArchive?.(confirmThreadId);
                  setConfirmThreadId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <header className="shrink-0 border-b border-border/70 bg-background px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-foreground">
              Knowhere Assistant
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Using{" "}
              <span className="font-semibold text-foreground">
                {sourceCount} {sourceCount === 1 ? "Source" : "Sources"}
              </span>
            </p>
          </div>
          {(onNewChat || onThreadSelect) && (
            <TooltipProvider>
              <div className="flex shrink-0 items-center gap-1.5">
                {onThreadSelect && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Open chat history"
                        onClick={() => setIsHistoryOpen(true)}
                      >
                        <History className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Chat history</TooltipContent>
                  </Tooltip>
                )}
                {onNewChat && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="New chat"
                        disabled={isCreatingThread}
                        onClick={handleNewChat}
                      >
                        {isCreatingThread ? (
                          <Spinner className="size-4" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>New chat</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TooltipProvider>
          )}
        </div>
      </header>

      <ChatHistorySheet
        threads={threads}
        activeThreadId={activeThreadId}
        isOpen={isHistoryOpen}
        isLoading={isHistoryLoading}
        isCreatingThread={isCreatingThread}
        loadingThreadId={loadingThreadId}
        archivingThreadIds={archivingThreadIds}
        onOpenChange={setIsHistoryOpen}
        onNewChat={onNewChat ? handleNewChat : undefined}
        onThreadSelect={onThreadSelect}
        onThreadArchive={onThreadArchive ? setConfirmThreadId : undefined}
      />

      <ScrollArea
        data-testid="chat-scroll"
        className="flex min-w-0 flex-1 flex-col overflow-x-hidden p-3 sm:p-4"
        viewportRef={viewportRef}
      >
        {messages.length === 0 ? (
          <EmptyChat disabled={isDisabled} needsLogin={Boolean(onLoginClick)} />
        ) : (
          <div
            className="relative mt-auto min-w-0"
            style={{ height: totalHeight }}
          >
            {virtualItems.map((virtualItem) => (
              <VirtualMessageRow
                key={virtualItem.key}
                virtualItem={virtualItem}
                message={messages[virtualItem.index]}
                measureElement={messageVirtualizer.measureElement}
                onCitationClick={onCitationClick}
                pendingCitationId={pendingCitationId}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <div
        data-testid="chat-composer"
        className="shrink-0 border-t border-border/70 bg-background p-3 sm:p-4"
      >
        {onLoginClick ? (
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={onLoginClick}
          >
            Log in to start
          </Button>
        ) : (
          <>
            <div className="relative rounded-2xl shadow-sm">
              <Textarea
                id={CHAT_COMPOSER_ID}
                name={CHAT_COMPOSER_ID}
                className="h-[84px] w-full min-w-0 resize-none rounded-2xl border-slate-300 bg-muted/60 p-3 pr-12 text-sm transition-all placeholder:text-muted-foreground hover:border-slate-400 focus-visible:border-primary focus-visible:ring-0 sm:p-3.5"
                placeholder={
                  isDisabled
                    ? "Upload a document to start asking questions."
                    : "Ask a question about your documents…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isDisabled}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canSend) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button
                variant="default"
                size="icon"
                className="absolute bottom-2 right-2"
                disabled={!canSend}
                onClick={handleSend}
                aria-label="Send message"
              >
                {isSending ? (
                  <Spinner className="size-4" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <span className="text-[10px] font-medium text-muted-foreground">
                Shift + Enter for a new line
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function VirtualMessageRow({
  virtualItem,
  message,
  measureElement,
  onCitationClick,
  pendingCitationId,
}: {
  virtualItem: VirtualItem;
  message: ChatMessageView | undefined;
  measureElement: (node: HTMLDivElement | null) => void;
  onCitationClick?: (citation: ChatCitationView, citationId: string) => void;
  pendingCitationId?: string | null;
}) {
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
      />
    </div>
  );
}

function ChatHistorySheet({
  threads,
  activeThreadId,
  isOpen,
  isLoading,
  isCreatingThread,
  loadingThreadId,
  archivingThreadIds,
  onOpenChange,
  onNewChat,
  onThreadSelect,
  onThreadArchive,
}: {
  threads: ChatThreadView[];
  activeThreadId: string | null;
  isOpen: boolean;
  isLoading: boolean;
  isCreatingThread: boolean;
  loadingThreadId: string | null;
  archivingThreadIds: readonly string[];
  onOpenChange: (open: boolean) => void;
  onNewChat?: () => void;
  onThreadSelect?: (threadId: string) => void;
  onThreadArchive?: (threadId: string) => void;
}) {
  const archivingThreadIdSet: ReadonlySet<string> = new Set(archivingThreadIds);
  const shouldUseGlobalThreadLoading = isLoading && loadingThreadId === null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(92vw,360px)] flex-col overflow-hidden p-0"
      >
        <SheetHeader className="shrink-0 border-b border-border/70 px-5 py-4 text-left">
          <div className="flex items-center justify-between gap-3 pr-8">
            <SheetTitle className="text-base">Chat history</SheetTitle>
            <SheetDescription className="sr-only">
              Recover an old chat or start a fresh chat.
            </SheetDescription>
            {onNewChat && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={isCreatingThread}
                onClick={onNewChat}
              >
                {isCreatingThread ? (
                  <Spinner className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
                {isCreatingThread ? "Creating…" : "New chat"}
              </Button>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1.5 p-4">
            {threads.length === 0 ? (
              <EmptyChatHistory />
            ) : (
              threads.map((thread) => (
                <ChatThreadRow
                  key={thread.id}
                  thread={thread}
                  isActive={thread.id === activeThreadId}
                  isLoading={shouldUseGlobalThreadLoading}
                  isSelecting={thread.id === loadingThreadId}
                  isArchiving={archivingThreadIdSet.has(thread.id)}
                  onSelect={() => {
                    onThreadSelect?.(thread.id);
                    onOpenChange(false);
                  }}
                  onArchive={
                    onThreadArchive
                      ? () => onThreadArchive(thread.id)
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function ChatThreadRow({
  thread,
  isActive,
  isLoading,
  isSelecting,
  isArchiving,
  onSelect,
  onArchive,
}: {
  thread: ChatThreadView;
  isActive: boolean;
  isLoading: boolean;
  isSelecting: boolean;
  isArchiving: boolean;
  onSelect: () => void;
  onArchive?: () => void;
}) {
  const isDisabled = isLoading || isSelecting || isArchiving;

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border p-2 transition-colors ${
        isActive
          ? "border-border/70 bg-muted/60 shadow-xs"
          : "border-transparent hover:bg-muted/40"
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        disabled={isDisabled}
        onClick={onSelect}
        aria-label={`Open ${thread.title} chat`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {thread.title}
          </span>
          <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {formatThreadDate(thread.updatedAt)}
          </span>
        </span>
        {isSelecting && <Spinner className="size-3.5 shrink-0" />}
      </button>
      {onArchive && (
        <button
          type="button"
          disabled={isArchiving}
          onClick={(event) => {
            event.stopPropagation();
            if (isArchiving) return;
            onArchive();
          }}
          className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-70"
          aria-label={`Delete ${thread.title} chat`}
        >
          {isArchiving ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

function EmptyChatHistory() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageCircle className="size-5" />
      </div>
      <p className="text-xs font-semibold text-foreground">No chats yet.</p>
    </div>
  );
}

function formatThreadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function EmptyChat({
  disabled,
  needsLogin,
}: {
  disabled: boolean;
  needsLogin: boolean;
}) {
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
}: {
  message: ChatMessageView;
  onCitationClick?: (citation: ChatCitationView, citationId: string) => void;
  pendingCitationId?: string | null;
}) {
  if (message.role === "user") {
    return (
      <div className="flex min-w-0 flex-col items-end">
        <div className="max-w-[85%] break-words rounded-2xl rounded-tr-sm bg-muted px-3 py-2.5 text-sm text-foreground shadow-xs sm:px-4 sm:py-3">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-start">
      <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-xs sm:max-w-[90%] sm:px-4 sm:py-3">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {message.citations && message.citations.length > 0 && (
          <div className="mt-3 border-t border-border/70 pt-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sources used
            </p>
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((cite, i) => {
                const citationId = getCitationId(message.id, i);
                const label = getCitationLabel(cite);
                const isPending = citationId === pendingCitationId;

                return (
                  <button
                    key={citationId}
                    type="button"
                    disabled={!onCitationClick || isPending}
                    onClick={() => onCitationClick?.(cite, citationId)}
                    className="inline-flex max-w-full cursor-pointer items-center gap-1.5 whitespace-normal rounded-lg border border-border bg-muted px-2 py-0 text-left text-[10px] font-medium text-muted-foreground shadow-2xs transition-colors hover:bg-muted/70 focus:outline-none focus:ring-4 focus:ring-ring/15 focus:ring-offset-2 focus:ring-offset-background disabled:cursor-wait disabled:opacity-75"
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

function getCitationId(messageId: string, citationIndex: number): string {
  return `${messageId}:${citationIndex}`;
}

function getCitationLabel(citation: ChatCitationView): string {
  return [
    citation.source.sourceFileName ?? "Section",
    citation.description ?? citation.source.sectionPath,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0,
    )
    .join(" · ");
}
