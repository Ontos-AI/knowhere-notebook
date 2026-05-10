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

/**
 * Right panel: chat with the assistant, grounded in the workspace sources.
 *
 * The panel is a pure view. The parent owns thread state, streaming, and
 * persistence (see /api/chat route). `onSend` is fired on user submit;
 * `onCitationClick` is forwarded to the parent so it can focus the Parsed
 * Content panel on the clicked section.
 */
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
    <section className="relative z-0 flex flex-[2] flex-col overflow-hidden border-l border-border bg-muted/40">
      <header className="shrink-0 border-b border-border bg-background px-6 py-4">
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

      <ScrollArea className="flex flex-1 flex-col p-4">
        {messages.length === 0 ? (
          <EmptyChat disabled={isDisabled} />
        ) : (
          <div className="mt-auto flex flex-col gap-5">
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

      <div className="shrink-0 border-t border-border bg-background p-4">
        <div className="relative rounded-xl shadow-sm">
          <Textarea
            id={CHAT_COMPOSER_ID}
            name={CHAT_COMPOSER_ID}
            className="h-[84px] w-full resize-none rounded-xl bg-muted/60 p-3.5 pr-12 text-sm transition-all placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
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
            size="icon-sm"
            className="absolute bottom-2 right-2"
            disabled={!canSend}
            onClick={handleSend}
            aria-label="Send message"
          >
            <Send />
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
    <div className="m-auto mt-24 flex h-full max-w-sm flex-col items-center justify-center px-4 pb-10 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-border bg-background text-primary/50 shadow-sm">
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
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-muted px-4 py-3 text-sm text-foreground shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground shadow-sm">
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.citations && message.citations.length > 0 && (
          <div className="mt-3 border-t border-border pt-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sources used
            </p>
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((cite, i) => (
                <Badge
                  key={`${cite.source.documentId ?? ""}-${i}`}
                  variant="outline"
                  onClick={() => onCitationClick?.(cite)}
                  className="group cursor-pointer rounded border-border bg-muted px-2 py-0 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/70"
                  title={
                    cite.description ??
                    `${cite.source.sourceFileName ?? "Source"}${cite.source.sectionPath ? ` · ${cite.source.sectionPath}` : ""}`
                  }
                >
                  {cite.description ??
                    cite.source.sourceFileName ??
                    "Source"}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
