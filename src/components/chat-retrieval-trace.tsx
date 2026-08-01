"use client";

import { type ReactElement } from "react";
import { Search } from "lucide-react";

import { CollapsibleSection } from "@/components/collapsible-section";
import type { RetrievalTraceView } from "@/domains/chat/types";

export function ChatRetrievalTrace({
  trace,
}: {
  readonly trace: RetrievalTraceView;
}): ReactElement | null {
  if (trace.queries.length === 0) return null;

  return (
    <CollapsibleSection
      title="Retrieval"
      icon={<Search className="size-3" />}
      badge={trace.queries.length}
    >
      {hasAnswerStats(trace) && (
        <div className="mb-1.5 rounded-md bg-muted/35 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
          {formatAnswerStats(trace)}
        </div>
      )}
      <div className="space-y-1.5">
        {trace.queries.map((entry, index) => (
          <div
            key={`${index}:${entry.namespace}:${entry.query}`}
            className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border/70 bg-muted/35 px-2.5 py-1.5"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-[11px] font-medium text-foreground">
                {entry.query}
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                {entry.resultCount} {entry.resultCount === 1 ? "hit" : "hits"}
              </span>
            </div>
            {entry.referencedChunkCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {entry.referencedChunkCount} cited{" "}
                {entry.referencedChunkCount === 1 ? "chunk" : "chunks"}
              </span>
            )}
            {entry.topScores.length > 0 && (
              <span className="truncate text-[10px] text-muted-foreground">
                top score: {formatTopScores(entry.topScores)}
              </span>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

function formatTopScores(scores: readonly number[]): string {
  return scores.map((score) => score.toFixed(3)).join(" · ");
}

function hasAnswerStats(trace: RetrievalTraceView): boolean {
  return (
    trace.durationSeconds !== undefined ||
    trace.llmCallCount !== undefined ||
    trace.inputTokens !== undefined ||
    trace.outputTokens !== undefined
  );
}

function formatAnswerStats(trace: RetrievalTraceView): string {
  const parts: string[] = [];

  if (trace.durationSeconds !== undefined) {
    parts.push(`${trace.durationSeconds.toFixed(1)}s`);
  }
  if (trace.llmCallCount !== undefined) {
    parts.push(
      `${trace.llmCallCount} ${trace.llmCallCount === 1 ? "LLM call" : "LLM calls"}`,
    );
  }
  if (
    trace.inputTokens !== undefined ||
    trace.outputTokens !== undefined
  ) {
    parts.push(
      `${trace.inputTokens ?? 0} in · ${trace.outputTokens ?? 0} out`,
    );
  }

  return parts.join(" · ");
}
