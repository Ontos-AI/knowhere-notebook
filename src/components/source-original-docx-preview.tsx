"use client";

import { type ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";

import { useSourceOriginalDocxWorkflow } from "@/components/source-original-docx-workflow";
import type { SourceOriginalFileView } from "@/domains/sources/types";

export function SourceOriginalDocxPreview({
  file,
}: {
  readonly file: SourceOriginalFileView;
}): ReactNode {
  const { containerRef, status } = useSourceOriginalDocxWorkflow({ file });

  return (
    <div className="min-h-[320px] overflow-auto rounded-lg bg-muted/30 p-3">
      {status.status === "loading" ? <LoadingPreview /> : null}
      {status.status === "failed" ? <UnsupportedPreview /> : null}
      <div
        key={file.url}
        ref={containerRef}
        className="original-docx-preview mx-auto max-w-full overflow-auto rounded-lg bg-background text-foreground"
      />
    </div>
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
