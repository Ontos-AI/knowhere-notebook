"use client";

import { useState } from "react";
import { Send, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type ChatPanelProps = {
  messages: ChatMessageView[];
  onSend?: (text: string) => void;
  isSending?: boolean;
};

export function ChatPanel({
  messages = [],
  onSend,
  isSending = false,
}: Partial<ChatPanelProps> = {}) {
  const [input, setInput] = useState("");
  const canSend = input.trim().length > 0 && !isSending;

  function handleSend() {
    if (!canSend) return;
    onSend?.(input.trim());
    setInput("");
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Ask</h2>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        {messages.length === 0 ? (
          <EmptyChatState />
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </ScrollArea>
      <Separator />
      <div className="p-3">
        <div className="relative">
          <Textarea
            placeholder="Ask a question about your documents..."
            className="min-h-[80px] resize-none pr-12"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canSend) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            size="icon-sm"
            className="absolute bottom-2 right-2"
            disabled={!canSend}
            onClick={handleSend}
            aria-label="Send message"
          >
            <Send />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Answers are generated from your uploaded documents using AI.
        </p>
      </div>
    </aside>
  );
}

function EmptyChatState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <MessageCircle className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          Ask anything about your documents
        </p>
        <p className="text-xs text-muted-foreground">
          Once you upload a source, you can ask questions and get answers
          grounded in your content.
        </p>
      </div>
      <div className="mt-3 flex w-full max-w-[220px] flex-col gap-2">
        <SuggestionChip text="Summarize the main points" />
        <SuggestionChip text="What are the key findings?" />
        <SuggestionChip text="Explain this in simple terms" />
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Sparkles className="size-3 shrink-0" />
      {text}
    </button>
  );
}

function ChatMessage({ message }: { message: ChatMessageView }) {
  const isUser = message.role === "user";
  return (
    <div
      className={
        isUser
          ? "ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
          : "mr-8 rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
      }
    >
      {message.content}
    </div>
  );
}
