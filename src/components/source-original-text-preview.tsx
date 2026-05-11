"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sourceOriginalPreviewModel } from "@/components/source-original-preview-model";
import { sourceOriginalPreviewRequest } from "@/components/source-original-preview-request";
import type { SourceOriginalFileView } from "@/domains/sources/types";

type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed" };

type UrlLoadState<T> = {
  readonly url: string;
  readonly state: LoadState<T>;
};

export type SourceOriginalTextPreviewProps = {
  readonly file: SourceOriginalFileView;
  readonly variant: "markdown" | "text";
};

export function SourceOriginalTextPreview({
  file,
  variant,
}: SourceOriginalTextPreviewProps): ReactNode {
  const state = useTextFile(file.url);

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

function useTextFile(url: string): LoadState<string> {
  const [loadState, setLoadState] = useState<UrlLoadState<string>>({
    url,
    state: { status: "loading" },
  });

  useEffect(() => {
    let isCurrent = true;
    const controller = new AbortController();

    async function loadText(): Promise<void> {
      try {
        const value = await sourceOriginalPreviewRequest.getText(
          url,
          controller.signal,
        );
        if (isCurrent) {
          setLoadState({ url, state: { status: "ready", value } });
        }
      } catch {
        if (isCurrent) {
          setLoadState({ url, state: { status: "failed" } });
        }
      }
    }

    void loadText();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [url]);

  return loadState.url === url ? loadState.state : { status: "loading" };
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
