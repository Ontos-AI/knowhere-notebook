"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type UIEvent,
} from "react";
import { BarChart3, FileText, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { chatPromptTemplates } from "@/domains/chat/prompt-templates";

const chatComposerId = "chat-composer";
const placeholderPattern = /(\[[^\]\r\n]{1,80}\])/gu;
const placeholderSegmentPattern = /^\[[^\]\r\n]{1,80}\]$/u;

export type ChatComposerProps = {
  readonly canCreateDiagram?: boolean;
  readonly isDisabled?: boolean;
  readonly isCreatingDiagram?: boolean;
  readonly isSending?: boolean;
  readonly onCreateDiagram?: () => void;
  readonly onLoginClick?: () => void;
  readonly onSend?: (text: string) => void;
};

export function ChatComposer({
  canCreateDiagram = false,
  isDisabled = false,
  isCreatingDiagram = false,
  isSending = false,
  onCreateDiagram,
  onLoginClick,
  onSend,
}: ChatComposerProps): ReactElement {
  const [input, setInput] = useState("");
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
    onSend?.(trimmedInput);
    setInput("");
    setTextareaScrollTop(0);
  }

  function handleTemplateSelect(prompt: string): void {
    setInput(prompt);
    setTextareaScrollTop(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function handleTextareaScroll(event: UIEvent<HTMLTextAreaElement>): void {
    setTextareaScrollTop(event.currentTarget.scrollTop);
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
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {chatPromptTemplates.map((template) => (
              <Button
                key={template.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={isDisabled || isSending}
                onClick={() => handleTemplateSelect(template.prompt)}
                className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[11px] font-semibold"
              >
                <FileText className="size-3.5" />
                <span>{template.title}</span>
              </Button>
            ))}
            {onCreateDiagram && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  isDisabled ||
                  isSending ||
                  isCreatingDiagram ||
                  !canCreateDiagram
                }
                onClick={onCreateDiagram}
                className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[11px] font-semibold"
                aria-label="Create diagram from latest answer"
              >
                {isCreatingDiagram ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <BarChart3 className="size-3.5" />
                )}
                <span>{isCreatingDiagram ? "Creating" : "Create diagram"}</span>
              </Button>
            )}
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-muted/60 shadow-sm">
            {input.length > 0 && (
              <pre
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-[84px] min-w-0 whitespace-pre-wrap break-words rounded-2xl border border-transparent p-3 font-sans text-sm leading-5 text-foreground sm:p-3.5"
              >
                <span
                  style={{ transform: `translateY(-${textareaScrollTop}px)` }}
                  className="block"
                >
                  {renderHighlightedInput(input)}
                </span>
              </pre>
            )}
            <Textarea
              ref={textareaRef}
              id={chatComposerId}
              name={chatComposerId}
              className={`relative h-[84px] w-full min-w-0 resize-none rounded-2xl border-input bg-transparent p-3 text-sm leading-5 transition-all placeholder:text-muted-foreground hover:border-primary/50 focus-visible:border-primary focus-visible:ring-0 sm:p-3.5 ${
                input.length > 0 ? "text-transparent caret-foreground" : "text-foreground"
              }`}
              placeholder={
                isDisabled
                  ? "Upload a document to start asking questions."
                  : "Ask a question about your documents…"
              }
              value={input}
              onChange={handleInputChange}
              disabled={isDisabled}
              onKeyDown={handleKeyDown}
              onScroll={handleTextareaScroll}
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

function renderHighlightedInput(value: string): readonly ReactElement[] {
  return value
    .split(placeholderPattern)
    .map((segment, index): ReactElement => {
      const key = `${index}-${segment.slice(0, 12)}`;
      if (placeholderSegmentPattern.test(segment)) {
        return (
          <span
            key={key}
            className="rounded-sm bg-primary/10 px-0.5 font-semibold text-primary"
          >
          {segment}
        </span>
      );
    }
      return <span key={key}>{segment}</span>;
    });
}
