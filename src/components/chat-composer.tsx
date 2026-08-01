"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { BarChart3, FileText, Send, WandSparkles } from "lucide-react";

import { usePromptTemplates } from "@/components/use-prompt-templates";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatPromptTemplate } from "@/domains/chat/prompt-templates";
import type { RetrievalOverrides } from "@/domains/chat/contracts";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
const chatComposerName = "chat-composer";
const chatComposerTextAreaMinHeight = 128;
const chatComposerTextAreaMaxHeight = 192;
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
  readonly onSend?: (text: string, retrievalParams: RetrievalOverrides) => void;
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
  const [retrievalParams, setRetrievalParams] = useState<RetrievalOverrides>({
    rerank: true,
    internalRecallK: 30,
    topK: 8,
  });
  const composerInputId = useId();
  const pendingTemplatePromptRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { isLoading: isLoadingTemplates, templates } = usePromptTemplates();
  const trimmedInput = input.trim();
  const canSend = !isDisabled && !isSending && trimmedInput.length > 0;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    resizeComposerTextArea(textarea);
  }, [input]);

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
    onSend?.(trimmedInput, retrievalParams);
    setInput("");
  }

  function handleTemplateSelect(prompt: string): void {
    pendingTemplatePromptRef.current = prompt;
    setInput(prompt);
  }

  function handleCreateMenuCloseAutoFocus(event: Event): void {
    const prompt = pendingTemplatePromptRef.current;
    if (prompt === null) return;

    event.preventDefault();
    requestAnimationFrame(() => {
      focusSelectedTemplatePlaceholder(prompt);
    });
  }

  function focusSelectedTemplatePlaceholder(prompt: string): void {
    pendingTemplatePromptRef.current = null;

    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.focus({ preventScroll: true });
    const placeholderRange = getFirstPlaceholderRange(prompt);
    if (!placeholderRange) {
      textarea.setSelectionRange(prompt.length, prompt.length);
      return;
    }

    textarea.setSelectionRange(placeholderRange.start, placeholderRange.end);
    textarea.scrollTop = 0;
  }

  function handleTextareaClick(event: MouseEvent<HTMLTextAreaElement>): void {
    const textarea = event.currentTarget;
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return;
    }

    const placeholderRange = getPlaceholderRangeAtPosition(
      textarea.value,
      textarea.selectionStart,
    );
    if (!placeholderRange) {
      return;
    }

    textarea.setSelectionRange(placeholderRange.start, placeholderRange.end);
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
            <Textarea
              ref={textareaRef}
              id={composerInputId}
              name={chatComposerName}
              aria-label="Chat message"
              rows={5}
              className="relative max-h-[192px] min-h-[128px] w-full min-w-0 resize-none overflow-y-hidden border-0 bg-transparent px-4 py-3 text-sm font-normal leading-5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 sm:px-5 sm:py-4"
              placeholder={
                isDisabled
                  ? "Add a ready source to start asking questions."
                  : "Ask a question about your documents…"
              }
              value={input}
              onChange={handleInputChange}
              disabled={isDisabled}
              onClick={handleTextareaClick}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <CreateMenu
                canCreateDiagram={canCreateDiagram}
                isCreatingDiagram={isCreatingDiagram}
                isDisabled={isDisabled || isSending}
                isLoadingTemplates={isLoadingTemplates}
                onCloseAutoFocus={handleCreateMenuCloseAutoFocus}
                onCreateDiagram={onCreateDiagram}
                onTemplateSelect={handleTemplateSelect}
                templates={templates}
              />
              <RetrievalParamsControls
                disabled={isDisabled || isSending}
                params={retrievalParams}
                onParamsChange={setRetrievalParams}
              />
            </div>
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

function resizeComposerTextArea(textarea: HTMLTextAreaElement): number {
  textarea.style.height = "auto";

  const hasInput = textarea.value.length > 0;
  const measuredHeight = hasInput
    ? textarea.scrollHeight
    : chatComposerTextAreaMinHeight;
  const nextHeight = clamp(
    measuredHeight,
    chatComposerTextAreaMinHeight,
    chatComposerTextAreaMaxHeight,
  );

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY =
    hasInput && measuredHeight > chatComposerTextAreaMaxHeight
      ? "auto"
      : "hidden";

  return nextHeight;
}

function RetrievalParamsControls({
  disabled,
  onParamsChange,
  params,
}: {
  readonly disabled: boolean;
  readonly onParamsChange: (params: RetrievalOverrides) => void;
  readonly params: RetrievalOverrides;
}): ReactElement {
  function update(changes: Partial<RetrievalOverrides>): void {
    onParamsChange({ ...params, ...changes });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-muted-foreground">
        Rerank
        <Switch
          size="sm"
          checked={params.rerank ?? true}
          disabled={disabled}
          onCheckedChange={(checked) =>
            update({ rerank: Boolean(checked) })
          }
          aria-label="Rerank retrieval results"
        />
      </label>
      <SliderControl
        ariaLabel="Internal recall K"
        disabled={disabled}
        label="Recall K"
        max={50}
        min={5}
        step={5}
        value={params.internalRecallK ?? 30}
        onChange={(value) => update({ internalRecallK: value })}
      />
      <SliderControl
        ariaLabel="Top K results"
        disabled={disabled}
        label="Top K"
        max={12}
        min={1}
        step={1}
        value={params.topK ?? 8}
        onChange={(value) => update({ topK: value })}
      />
    </div>
  );
}

function SliderControl({
  ariaLabel,
  disabled,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly step: number;
  readonly value: number;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      <Slider
        aria-label={ariaLabel}
        className="w-24"
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        value={value}
        onValueChange={(nextValue) =>
          onChange(typeof nextValue === "number" ? nextValue : (nextValue[0] ?? value))
        }
      />
      <span className="w-7 text-right font-mono text-[11px] font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

function CreateMenu({
  canCreateDiagram,
  isCreatingDiagram,
  isDisabled,
  isLoadingTemplates,
  onCloseAutoFocus,
  onCreateDiagram,
  onTemplateSelect,
  templates,
}: {
  readonly canCreateDiagram: boolean;
  readonly isCreatingDiagram: boolean;
  readonly isDisabled: boolean;
  readonly isLoadingTemplates: boolean;
  readonly onCloseAutoFocus: (event: Event) => void;
  readonly onCreateDiagram?: () => void;
  readonly onTemplateSelect: (prompt: string) => void;
  readonly templates: readonly ChatPromptTemplate[];
}): ReactElement {
  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <DropdownMenuTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isDisabled}
                aria-label="Prompts / Chart"
                className="h-9 w-9 rounded-md border-0 bg-muted px-0 text-muted-foreground shadow-none hover:bg-muted/80"
              >
                <WandSparkles className="size-4" />
              </Button>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <TooltipContent side="top">Prompts / Chart</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-72"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {isLoadingTemplates ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Loading templates
          </div>
        ) : (
          <>
            {templates.map((template) => (
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
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
