"use client";

import { type ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import { useSourceOriginalTextWorkflow } from "@/components/source-original-text-workflow";
import type { SourceOriginalFileView } from "@/domains/sources/types";

export type SourceOriginalTextPreviewProps = {
  readonly file: SourceOriginalFileView;
  readonly variant: "markdown" | "text";
};

export function SourceOriginalTextPreview({
  file,
  variant,
}: SourceOriginalTextPreviewProps): ReactNode {
  const state = useSourceOriginalTextWorkflow({ file });

  if (state.status === "loading") return <LoadingPreview />;
  if (state.status === "failed") return <UnsupportedPreview />;

  if (variant === "markdown") {
    return (
      <div className="original-markdown-preview min-w-0 max-w-full overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {sourceOriginalPreviewModel.normalizeMarkdownPreviewText(state.value)}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className="max-h-[calc(100dvh-14rem)] overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground sm:text-sm">
      {state.value}
    </pre>
  );
}

function LoadingPreview(): ReactNode {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading preview...</p>
    </div>
  );
}

function UnsupportedPreview(): ReactNode {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <FileText className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        Preview is not available for this file.
      </p>
    </div>
  );
}
