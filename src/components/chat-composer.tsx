"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type UIEvent,
} from "react";
import { BarChart3, FileText, Plus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { chatPromptTemplates } from "@/domains/chat/prompt-templates";
import {
  trackNotebookAssistantQuestionSubmitted,
  type AnalyticsContext,
} from "@/lib/posthog";

const chatComposerId = "chat-composer";
const placeholderPattern = /(\[[^\]\r\n]{1,80}\])/gu;
const placeholderSegmentPattern = /^\[[^\]\r\n]{1,80}\]$/u;

export type ChatComposerProps = {
  readonly canCreateDiagram?: boolean;
  readonly isDisabled?: boolean;
  readonly isCreatingDiagram?: boolean;
  readonly isSending?: boolean;
  readonly activeThreadId?: string | null;
  readonly analyticsContext?: AnalyticsContext;
  readonly sourceCountSnapshot?: number;
  readonly selectedSourcesCount?: number;
  readonly onCreateDiagram?: () => void;
  readonly onLoginClick?: () => void;
  readonly onSend?: (text: string) => void;
};

export function ChatComposer({
  canCreateDiagram = false,
  isDisabled = false,
  isCreatingDiagram = false,
  isSending = false,
  activeThreadId = null,
  analyticsContext,
  sourceCountSnapshot = 0,
  selectedSourcesCount = 0,
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
    void trackNotebookAssistantQuestionSubmitted({
      context: analyticsContext,
      threadId: activeThreadId,
      selectedSourcesCount,
      sourceCountSnapshot,
      messageLength: trimmedInput.length,
    });
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
          <div className="relative overflow-hidden bg-background">
            {input.length > 0 && (
              <pre
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-[128px] min-w-0 whitespace-pre-wrap break-words border border-transparent px-4 py-3 font-sans text-sm leading-5 text-foreground sm:px-5 sm:py-4"
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
              className={`relative h-[128px] w-full min-w-0 resize-none border-0 bg-transparent px-4 py-3 text-sm leading-5 shadow-none transition-all placeholder:text-muted-foreground focus-visible:ring-0 sm:px-5 sm:py-4 ${
                input.length > 0 ? "text-transparent caret-foreground" : "text-foreground"
              }`}
              placeholder={
                isDisabled
                  ? "Add a ready source to start asking questions."
                  : "Ask a question about your documents…"
              }
              value={input}
              onChange={handleInputChange}
              disabled={isDisabled}
              onKeyDown={handleKeyDown}
              onScroll={handleTextareaScroll}
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 pb-4 sm:px-5">
            <CreateMenu
              canCreateDiagram={canCreateDiagram}
              isCreatingDiagram={isCreatingDiagram}
              isDisabled={isDisabled || isSending}
              onCreateDiagram={onCreateDiagram}
              onTemplateSelect={handleTemplateSelect}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              className="ml-auto h-12 min-w-28 gap-1.5 rounded-lg px-6"
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

function CreateMenu({
  canCreateDiagram,
  isCreatingDiagram,
  isDisabled,
  onCreateDiagram,
  onTemplateSelect,
}: {
  readonly canCreateDiagram: boolean;
  readonly isCreatingDiagram: boolean;
  readonly isDisabled: boolean;
  readonly onCreateDiagram?: () => void;
  readonly onTemplateSelect: (prompt: string) => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isDisabled}
          className="h-9 gap-1.5 rounded-md border-0 bg-muted px-4 text-xs font-semibold text-muted-foreground shadow-none hover:bg-muted/80"
        >
          <Plus className="size-3.5" />
          Create
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72">
        {chatPromptTemplates.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onSelect={() => onTemplateSelect(template.prompt)}
          >
            <FileText className="size-4" />
            {template.title}
          </DropdownMenuItem>
        ))}
        {onCreateDiagram ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canCreateDiagram || isCreatingDiagram}
              onSelect={onCreateDiagram}
              aria-label="Create diagram from latest answer"
            >
              {isCreatingDiagram ? (
                <Spinner className="size-4" />
              ) : (
                <BarChart3 className="size-4" />
              )}
              {isCreatingDiagram ? "Creating diagram" : "Create diagram"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
