"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
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
const chatComposerId = "chat-composer";
const placeholderPattern = /(\[[^\]\r\n]{1,80}\])/gu;
const placeholderSegmentPattern = /^\[[^\]\r\n]{1,80}\]$/u;
const placeholderRangePattern = /\[[^\]\r\n]{1,80}\]/gu;

type TextRange = {
  readonly start: number;
  readonly end: number;
};

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
  const [hasActiveTextSelection, setHasActiveTextSelection] = useState(false);
  const [textareaScrollTop, setTextareaScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmedInput = input.trim();
  const canSend = !isDisabled && !isSending && trimmedInput.length > 0;
  const shouldShowHighlightLayer = input.length > 0 && !hasActiveTextSelection;

  function handleInputChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setInput(event.target.value);
    setHasActiveTextSelection(false);
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
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();
      const placeholderRange = getFirstPlaceholderRange(prompt);
      if (!placeholderRange) {
        textarea.setSelectionRange(prompt.length, prompt.length);
        setHasActiveTextSelection(false);
        return;
      }

      textarea.setSelectionRange(placeholderRange.start, placeholderRange.end);
      setHasActiveTextSelection(true);
    });
  }

  function handleTextareaScroll(event: UIEvent<HTMLTextAreaElement>): void {
    setTextareaScrollTop(event.currentTarget.scrollTop);
  }

  function handleTextareaClick(event: MouseEvent<HTMLTextAreaElement>): void {
    const textarea = event.currentTarget;
    if (textarea.selectionStart !== textarea.selectionEnd) {
      setHasActiveTextSelection(true);
      return;
    }

    const placeholderRange = getPlaceholderRangeAtPosition(
      textarea.value,
      textarea.selectionStart,
    );
    if (!placeholderRange) {
      setHasActiveTextSelection(false);
      return;
    }

    textarea.setSelectionRange(placeholderRange.start, placeholderRange.end);
    setHasActiveTextSelection(true);
  }

  function refreshTextareaSelectionState(): void {
    const textarea = textareaRef.current;
    setHasActiveTextSelection(
      Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd),
    );
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
            {shouldShowHighlightLayer && (
              <pre
                aria-hidden="true"
                data-testid="chat-composer-highlight-layer"
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
              className="relative h-[128px] w-full min-w-0 resize-none border-0 bg-transparent px-4 py-3 text-sm leading-5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 sm:px-5 sm:py-4"
              placeholder={
                isDisabled
                  ? "Add a ready source to start asking questions."
                  : "Ask a question about your documents…"
              }
              value={input}
              onChange={handleInputChange}
              disabled={isDisabled}
              onBlur={() => setHasActiveTextSelection(false)}
              onClick={handleTextareaClick}
              onKeyDown={handleKeyDown}
              onKeyUp={refreshTextareaSelectionState}
              onScroll={handleTextareaScroll}
              onSelect={refreshTextareaSelectionState}
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
            className="rounded-sm bg-primary/10 text-primary"
          >
          {segment}
        </span>
      );
    }
      return <span key={key}>{segment}</span>;
    });
}

function getFirstPlaceholderRange(value: string): TextRange | null {
  const [firstMatch] = value.matchAll(placeholderRangePattern);
  if (!firstMatch) return null;
  const start = firstMatch.index;
  return { start, end: start + firstMatch[0].length };
}

function getPlaceholderRangeAtPosition(
  value: string,
  position: number,
): TextRange | null {
  for (const match of value.matchAll(placeholderRangePattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (position >= start && position <= end) {
      return { start, end };
    }
  }
  return null;
}
