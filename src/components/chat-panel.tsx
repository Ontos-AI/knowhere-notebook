"use client";

import { useState } from "react";
import { Send, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { ChatCitationView, ChatMessageView } from "@/lib/types";

const CHAT_COMPOSER_ID = "chat-composer";

export type ChatPanelProps = {
  messages: ChatMessageView[];
  onSend?: (text: string) => void;
  onCitationClick?: (citation: ChatCitationView) => void;
  sourceCount?: number;
  isSending?: boolean;
  isDisabled?: boolean;
};

export function ChatPanel({
  messages = [],
  onSend,
  onCitationClick,
  sourceCount = 0,
  isSending = false,
  isDisabled = false,
}: Partial<ChatPanelProps> = {}) {
  const [input, setInput] = useState("");
  const canSend = !isDisabled && !isSending && input.trim().length > 0;

  function handleSend() {
    if (!canSend) return;
    onSend?.(input.trim());
    setInput("");
  }

  return (
    <section
      data-testid="chat-panel"
      className="relative z-0 flex h-full w-full max-w-full min-w-0 flex-col overflow-hidden border-border/70 bg-muted/40 lg:border-l"
    >
      <header className="shrink-0 border-b border-border/70 bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-sm font-bold text-foreground">
          Knowhere Assistant
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Using{" "}
          <span className="font-semibold text-foreground">
            {sourceCount} {sourceCount === 1 ? "Source" : "Sources"}
          </span>
        </p>
      </header>

      <ScrollArea
        data-testid="chat-scroll"
        className="flex min-w-0 flex-1 flex-col overflow-x-hidden p-3 sm:p-4"
      >
        {messages.length === 0 ? (
          <EmptyChat disabled={isDisabled} />
        ) : (
          <div className="mt-auto flex min-w-0 flex-col gap-4 sm:gap-5">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onCitationClick={onCitationClick}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <div
        data-testid="chat-composer"
        className="shrink-0 border-t border-border/70 bg-background p-3 sm:p-4"
      >
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
            <Send className="size-4" />
          </Button>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <span className="text-[10px] font-medium text-muted-foreground">
            Shift + Enter for a new line
          </span>
        </div>
      </div>
    </section>
  );
}

function EmptyChat({ disabled }: { disabled: boolean }) {
  return (
    <div className="m-auto mt-16 flex h-full w-full max-w-sm flex-col items-center justify-center px-3 pb-8 text-center sm:mt-24 sm:px-4 sm:pb-10">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-background text-primary/50 shadow-xs">
        <MessageCircle className="size-7" />
      </div>
      <h3 className="mb-1.5 text-sm font-bold text-foreground">
        How may I assist you today?
      </h3>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {disabled
          ? "Upload a document to start asking questions."
          : "Ask anything about your sources. Answers include source links when Notebook finds support."}
      </p>
    </div>
  );
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessageView;
  onCitationClick?: (citation: ChatCitationView) => void;
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
              {message.citations.map((cite, i) => (
                <Badge
                  key={`${cite.source.documentId ?? ""}-${i}`}
                  variant="outline"
                  onClick={() => onCitationClick?.(cite)}
                  className="max-w-full cursor-pointer whitespace-normal rounded-full bg-muted px-2 py-0 text-left text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/70"
                >
                  {cite.source.sourceFileName ?? "Section"}
                  {cite.source.sectionPath ? ` · ${cite.source.sectionPath}` : ""}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
