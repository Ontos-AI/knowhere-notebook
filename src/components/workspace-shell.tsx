"use client";

import { startTransition, useEffect, useState } from "react";
import { TopNav } from "@/components/top-nav";
import { SourcesPanel } from "@/components/sources-panel";
import { ChunksPanel } from "@/components/chunks-panel";
import { ChatPanel } from "@/components/chat-panel";
import type { SourceView } from "@/lib/types";
import type { UploadSourceActionState } from "@/app/actions";

export type WorkspaceShellProps = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
  /**
   * Workspace metadata. Unused in this PR's shell — PR-C wires it into
   * the upload action, chunks fetch, and chat route.
   */
  workspace: {
    id: string;
    namespace: string;
  };
  sources: SourceView[];
  uploadAction: (
    state: UploadSourceActionState,
    formData: FormData,
  ) => Promise<UploadSourceActionState>;
};

/**
 * Authenticated workspace shell.
 *
 * Receives identity and workspace metadata from the server component that
 * already verified the session. Sources / chunks / messages are still
 * placeholders until PR-C (upload) and PR-E (chat) wire them to the
 * Knowhere API and Postgres.
 */
export function WorkspaceShell({
  user,
  sources: initialSources,
  uploadAction,
}: WorkspaceShellProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null);
  const [sources, setSources] = useState(initialSources);

  useEffect(() => {
    const hasPendingSources = sources.some(
      (source) => source.status === "uploading" || source.status === "parsing",
    );
    if (!hasPendingSources) return;

    const interval = window.setInterval(() => {
      startTransition(async () => {
        const response = await fetch("/api/sources", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { sources?: SourceView[] };
        if (Array.isArray(body.sources)) setSources(body.sources);
      });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [sources]);

  const showParsed = selectedSourceId !== null || focusedChunkId !== null;
  const showChat = selectedSourceId === null || focusedChunkId !== null;

  function handleSourceUploaded(source: SourceView) {
    setSources((current) => [
      source,
      ...current.filter((candidate) => candidate.id !== source.id),
    ]);
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-muted/40">
      <TopNav
        userInitials={initialsOf(user)}
        userName={user.name ?? user.email ?? undefined}
      />
      <div className="relative flex flex-1 overflow-hidden">
        <SourcesPanel
          sources={sources}
          onSourceUploaded={handleSourceUploaded}
          selectedSourceId={selectedSourceId}
          onSelectSource={(id) => {
            setSelectedSourceId(id);
            setFocusedChunkId(null);
          }}
          uploadAction={uploadAction}
        />
        {showParsed && (
          <ChunksPanel
            selectedSource={selectedSourceId}
            focusedChunkId={focusedChunkId}
            onClose={() => {
              setSelectedSourceId(null);
              setFocusedChunkId(null);
            }}
          />
        )}
        {showChat && (
          <ChatPanel
            isDisabled
            sourceCount={
              sources.filter((source) => source.status === "ready").length
            }
            onCitationClick={(cite) => {
              setFocusedChunkId(cite.source.documentId ?? null);
              setSelectedSourceId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function initialsOf(user: WorkspaceShellProps["user"]): string {
  const source = user.name ?? user.email ?? user.id;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[1][0]!).toUpperCase();
}
