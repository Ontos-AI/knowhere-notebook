"use client";

import {
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  trackNotebookAssistantQuestionSubmitted,
  type AnalyticsContext,
} from "@/lib/posthog";

const chatComposerId = "chat-composer";

export type ChatComposerProps = {
  readonly isDisabled?: boolean;
  readonly isSending?: boolean;
  readonly activeThreadId?: string | null;
  readonly analyticsContext?: AnalyticsContext;
  readonly sourceCountSnapshot?: number;
  readonly selectedSourcesCount?: number;
  readonly onLoginClick?: () => void;
  readonly onSend?: (text: string) => void;
};

export function ChatComposer({
  isDisabled = false,
  isSending = false,
  activeThreadId = null,
  analyticsContext,
  sourceCountSnapshot = 0,
  selectedSourcesCount = 0,
  onLoginClick,
  onSend,
}: ChatComposerProps): ReactElement {
  const [input, setInput] = useState("");
  const trimmedInput = input.trim();
  const canSend = !isDisabled && !isSending && trimmedInput.length > 0;

  function handleInputChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setInput(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && canSend) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleSend(): void {
    if (!canSend) return;
    void trackNotebookAssistantQuestionSubmitted({
      context: analyticsContext,
      threadId: activeThreadId,
      selectedSourcesCount,
      sourceCountSnapshot,
      messageLength: trimmedInput.length,
    });
    onSend?.(trimmedInput);
    setInput("");
  }

  return (
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
          <div className="rounded-2xl shadow-sm">
            <Textarea
              id={chatComposerId}
              name={chatComposerId}
              className="h-[84px] w-full min-w-0 resize-none rounded-2xl border-input bg-muted/60 p-3 text-sm text-foreground transition-all placeholder:text-muted-foreground hover:border-primary/50 focus-visible:border-primary focus-visible:ring-0 sm:p-3.5"
              placeholder={
                isDisabled
                  ? "Upload a document to start asking questions."
                  : "Ask a question about your documents…"
              }
              value={input}
              onChange={handleInputChange}
              disabled={isDisabled}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">
              Shift + Enter for a new line
            </span>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="ml-auto gap-1.5 px-4"
              disabled={!canSend}
              onClick={handleSend}
              aria-label="Send message"
            >
              {isSending ? (
                <Spinner className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              <span>{isSending ? "Sending" : "Send"}</span>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
