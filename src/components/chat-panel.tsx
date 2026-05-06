"use client";

import { useState } from "react";
import { Send, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function ChatPanel() {
  const [messages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const canSend = input.trim().length > 0;

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
                // Will be wired up to the AI SDK
              }
            }}
          />
          <Button
            size="sm"
            className="absolute bottom-2 right-2 h-7 w-7 p-0"
            disabled={!canSend}
          >
            <Send className="h-3.5 w-3.5" />
            <span className="sr-only">Send message</span>
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
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <MessageCircle className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Ask anything about your documents
        </p>
        <p className="text-xs text-muted-foreground">
          Once you upload a source, you can ask questions and get answers
          grounded in your content.
        </p>
      </div>
      <div className="mt-3 flex flex-col gap-2 w-full max-w-[220px]">
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
      <Sparkles className="h-3 w-3 shrink-0" />
      {text}
    </button>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm ${
        isUser
          ? "ml-8 bg-primary text-primary-foreground"
          : "mr-8 bg-muted text-foreground"
      }`}
    >
      {message.content}
    </div>
  );
}
