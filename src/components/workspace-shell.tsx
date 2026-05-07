"use client";

import { startTransition, useEffect, useState } from "react";
import { TopNav } from "@/components/top-nav";
import { SourcesPanel } from "@/components/sources-panel";
import { ChunksPanel } from "@/components/chunks-panel";
import { ChatPanel } from "@/components/chat-panel";
import { resolveCitationChunk } from "@/lib/chunks";
import type {
  ChatCitationView,
  ChatMessageView,
  ParsedChunkView,
  SourceView,
} from "@/lib/types";
import type { UploadSourceActionState } from "@/app/actions";

type ChunkLoadState = {
  sourceId: string | null;
  chunks: ParsedChunkView[];
  isLoading: boolean;
};

type ChatState = {
  threadId: string | null;
  messages: ChatMessageView[];
  isSending: boolean;
  error: string | null;
};

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
  const [chat, setChat] = useState<ChatState>({
    threadId: null,
    messages: [],
    isSending: false,
    error: null,
  });
  const [chunkLoad, setChunkLoad] = useState<ChunkLoadState>({
    sourceId: null,
    chunks: [],
    isLoading: false,
  });

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
        if (!Array.isArray(body.sources)) return;
        const refreshedSources = body.sources;

        setSources((current) => mergeSourceQueryState(refreshedSources, current));
        const selectedSource = refreshedSources.find(
          (source) => source.id === selectedSourceId,
        );
        if (
          selectedSource &&
          selectedSource.status === "ready" &&
          chunkLoad.sourceId !== selectedSource.id
        ) {
          setChunkLoad({ sourceId: selectedSource.id, chunks: [], isLoading: true });
        }
      });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [chunkLoad.sourceId, selectedSourceId, sources]);

  useEffect(() => {
    if (!chunkLoad.isLoading || !chunkLoad.sourceId) return;

    let isCurrent = true;
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/sources/${encodeURIComponent(chunkLoad.sourceId!)}/chunks`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          chunks?: ParsedChunkView[];
        };
        if (!isCurrent) return;
        setChunkLoad({
          sourceId: chunkLoad.sourceId,
          chunks: Array.isArray(body.chunks) ? body.chunks : [],
          isLoading: false,
        });
      } finally {
        if (isCurrent) {
          setChunkLoad((current) =>
            current.sourceId === chunkLoad.sourceId
              ? { ...current, isLoading: false }
              : current,
          );
        }
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [chunkLoad.isLoading, chunkLoad.sourceId]);

  const showParsed = selectedSourceId !== null || focusedChunkId !== null;
  const showChat = selectedSourceId === null || focusedChunkId !== null;
  const selectedSourceTitle =
    sources.find((source) => source.id === selectedSourceId)?.title ?? null;

  function handleSourceUploaded(source: SourceView) {
    setSources((current) => [
      source,
      ...current.filter((candidate) => candidate.id !== source.id),
    ]);
  }

  function handleToggleIncluded(sourceId: string, included: boolean) {
    setSources((current) =>
      current.map((source) =>
        source.id === sourceId
          ? { ...source, excludedFromQuery: !included }
          : source,
      ),
    );
  }

  function handleSourceSelected(sourceId: string | null) {
    setSelectedSourceId(sourceId);
    setFocusedChunkId(null);
    setChunkLoad({ sourceId: null, chunks: [], isLoading: false });

    if (!sourceId) return;

    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source || source.status !== "ready") return;

    setChunkLoad({ sourceId, chunks: [], isLoading: true });
  }

  async function handleChatSend(text: string) {
    setChat((current) => ({ ...current, isSending: true, error: null }));
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          threadId: chat.threadId ?? undefined,
          excludedSourceIds: sources
            .filter((source) => source.excludedFromQuery)
            .map((source) => source.id),
        }),
      });
      const body = (await response.json()) as {
        threadId?: string;
        messages?: ChatMessageView[];
        message?: string;
      };
      if (!response.ok || !body.threadId || !Array.isArray(body.messages)) {
        setChat((current) => ({
          ...current,
          isSending: false,
          error: body.message ?? "The assistant could not answer right now.",
        }));
        return;
      }

      setChat((current) => ({
        threadId: body.threadId ?? current.threadId,
        messages: [...current.messages, ...body.messages!],
        isSending: false,
        error: null,
      }));
    } catch {
      setChat((current) => ({
        ...current,
        isSending: false,
        error: "The assistant could not answer right now.",
      }));
    }
  }

  async function handleCitationClick(citation: ChatCitationView) {
    const source = sources.find(
      (candidate) => candidate.documentId === citation.source.documentId,
    );
    if (!source) return;

    setSelectedSourceId(source.id);
    setFocusedChunkId(null);
    setChunkLoad({ sourceId: source.id, chunks: [], isLoading: true });

    const chunks = await fetchChunks(source.id);
    const focusedChunk = resolveCitationChunk(citation, chunks);
    setChunkLoad({ sourceId: source.id, chunks, isLoading: false });
    setFocusedChunkId(focusedChunk?.chunkId ?? null);
  }

  const readySourceCount = sources.filter(
    (source) => source.status === "ready",
  ).length;

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
            handleSourceSelected(id);
          }}
          onToggleIncluded={handleToggleIncluded}
          uploadAction={uploadAction}
        />
        {showParsed && (
          <ChunksPanel
            chunks={chunkLoad.chunks}
            selectedSource={selectedSourceTitle}
            focusedChunkId={focusedChunkId}
            isLoading={chunkLoad.isLoading}
            onClose={() => {
              setSelectedSourceId(null);
              setFocusedChunkId(null);
              setChunkLoad({ sourceId: null, chunks: [], isLoading: false });
            }}
          />
        )}
        {showChat && (
          <ChatPanel
            messages={chat.messages}
            isDisabled={readySourceCount === 0}
            isSending={chat.isSending}
            sourceCount={readySourceCount}
            onSend={handleChatSend}
            onCitationClick={handleCitationClick}
          />
        )}
      </div>
      {chat.error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-lg">
          {chat.error}
        </div>
      )}
    </div>
  );
}

async function fetchChunks(sourceId: string): Promise<ParsedChunkView[]> {
  const response = await fetch(
    `/api/sources/${encodeURIComponent(sourceId)}/chunks`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { chunks?: ParsedChunkView[] };
  return Array.isArray(body.chunks) ? body.chunks : [];
}

function mergeSourceQueryState(
  nextSources: readonly SourceView[],
  currentSources: readonly SourceView[],
): SourceView[] {
  const currentById = new Map(
    currentSources.map((source) => [source.id, source.excludedFromQuery]),
  );
  return nextSources.map((source) => ({
    ...source,
    excludedFromQuery: currentById.get(source.id) ?? source.excludedFromQuery,
  }));
}

function initialsOf(user: WorkspaceShellProps["user"]): string {
  const source = user.name ?? user.email ?? user.id;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[1][0]!).toUpperCase();
}
