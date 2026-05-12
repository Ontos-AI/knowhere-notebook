"use client";

import { useState } from "react";

import type { ChatThreadView } from "@/domains/chat/types";

type ChatPanelWorkflowInput = {
  readonly isCreatingThread: boolean;
  readonly onNewChat?: () => void;
  readonly onThreadArchive?: (threadId: string) => void;
  readonly threads: readonly ChatThreadView[];
};

type ChatPanelWorkflow = {
  readonly confirmThread: ChatThreadView | null;
  readonly confirmThreadId: string | null;
  readonly isHistoryOpen: boolean;
  readonly handleArchiveConfirm: () => void;
  readonly handleArchiveDialogOpenChange: (open: boolean) => void;
  readonly handleHistoryOpenChange: (open: boolean) => void;
  readonly handleNewChat: () => void;
  readonly handleThreadArchiveRequest: (threadId: string) => void;
};

export function useChatPanelWorkflow({
  isCreatingThread,
  onNewChat,
  onThreadArchive,
  threads,
}: ChatPanelWorkflowInput): ChatPanelWorkflow {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [confirmThreadId, setConfirmThreadId] = useState<string | null>(null);
  const confirmThread =
    threads.find((thread) => thread.id === confirmThreadId) ?? null;

  function handleNewChat(): void {
    if (isCreatingThread) return;
    onNewChat?.();
    setIsHistoryOpen(false);
  }

  function handleArchiveConfirm(): void {
    if (!confirmThreadId) return;
    onThreadArchive?.(confirmThreadId);
    setConfirmThreadId(null);
  }

  function handleArchiveDialogOpenChange(open: boolean): void {
    if (!open) setConfirmThreadId(null);
  }

  function handleHistoryOpenChange(open: boolean): void {
    setIsHistoryOpen(open);
  }

  function handleThreadArchiveRequest(threadId: string): void {
    setConfirmThreadId(threadId);
  }

  return {
    confirmThread,
    confirmThreadId,
    isHistoryOpen,
    handleArchiveConfirm,
    handleArchiveDialogOpenChange,
    handleHistoryOpenChange,
    handleNewChat,
    handleThreadArchiveRequest,
  };
}
