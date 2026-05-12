"use client";

import {
  type ReactElement,
} from "react";
import { History, Plus } from "lucide-react";
import { ChatComposer } from "@/components/chat-composer";
import { ChatHistorySheet } from "@/components/chat-history-sheet";
import { ChatMessageList } from "@/components/chat-message-list";
import { useChatPanelWorkflow } from "@/components/chat-panel-workflow";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ChatCitationView,
  ChatMessageView,
  ChatThreadView,
} from "@/domains/chat/types";

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
  sourceTitlesByDocumentId?: Readonly<Record<string, string>>;
  sourceCount?: number;
  isSending?: boolean;
  isHistoryLoading?: boolean;
  isCreatingThread?: boolean;
  loadingThreadId?: string | null;
  archivingThreadIds?: readonly string[];
  pendingCitationId?: string | null;
  pendingStatusText?: string | null;
  isDisabled?: boolean;
};

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
  sourceTitlesByDocumentId = {},
  sourceCount = 0,
  isSending = false,
  isHistoryLoading = false,
  isCreatingThread = false,
  loadingThreadId = null,
  archivingThreadIds = [],
  pendingCitationId = null,
  pendingStatusText = null,
  isDisabled = false,
}: Partial<ChatPanelProps> = {}): ReactElement {
  const {
    confirmThread,
    confirmThreadId,
    isHistoryOpen,
    handleArchiveConfirm,
    handleArchiveDialogOpenChange,
    handleHistoryOpenChange,
    handleNewChat,
    handleThreadArchiveRequest,
  } = useChatPanelWorkflow({
    isCreatingThread,
    onNewChat,
    onThreadArchive,
    threads,
  });

  return (
    <section
      data-testid="chat-panel"
      className="relative z-0 flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden border-border/70 bg-muted/40 lg:border-l"
    >
      <AlertDialog
        open={confirmThreadId !== null}
        onOpenChange={handleArchiveDialogOpenChange}
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
            <AlertDialogAction onClick={handleArchiveConfirm}>
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
                        onClick={() => handleHistoryOpenChange(true)}
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
        onOpenChange={handleHistoryOpenChange}
        onNewChat={onNewChat ? handleNewChat : undefined}
        onThreadSelect={onThreadSelect}
        onThreadArchive={
          onThreadArchive ? handleThreadArchiveRequest : undefined
        }
      />

      <ChatMessageList
        isDisabled={isDisabled}
        isSending={isSending}
        messages={messages}
        needsLogin={Boolean(onLoginClick)}
        onCitationClick={onCitationClick}
        pendingCitationId={pendingCitationId}
        pendingStatusText={pendingStatusText}
        sourceTitlesByDocumentId={sourceTitlesByDocumentId}
      />

      <ChatComposer
        isDisabled={isDisabled}
        isSending={isSending}
        onLoginClick={onLoginClick}
        onSend={onSend}
      />
    </section>
  );
}
