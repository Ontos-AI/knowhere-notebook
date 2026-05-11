"use client";

import type { ReactElement } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";

import { chatPanelModel } from "@/components/chat-panel-model";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ChatThreadView } from "@/domains/chat/types";

export type ChatHistorySheetProps = {
  readonly activeThreadId: string | null;
  readonly archivingThreadIds: readonly string[];
  readonly isCreatingThread: boolean;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly loadingThreadId: string | null;
  readonly onNewChat?: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onThreadArchive?: (threadId: string) => void;
  readonly onThreadSelect?: (threadId: string) => void;
  readonly threads: readonly ChatThreadView[];
};

export function ChatHistorySheet({
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
}: ChatHistorySheetProps): ReactElement {
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
  readonly thread: ChatThreadView;
  readonly isActive: boolean;
  readonly isLoading: boolean;
  readonly isSelecting: boolean;
  readonly isArchiving: boolean;
  readonly onSelect: () => void;
  readonly onArchive?: () => void;
}): ReactElement {
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
            {chatPanelModel.formatThreadDate(thread.updatedAt)}
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

function EmptyChatHistory(): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageCircle className="size-5" />
      </div>
      <p className="text-xs font-semibold text-foreground">No chats yet.</p>
    </div>
  );
}
