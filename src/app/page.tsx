"use client";

import { useState } from "react";
import { TopNav } from "@/components/top-nav";
import { SourcesPanel } from "@/components/sources-panel";
import { ChunksPanel } from "@/components/chunks-panel";
import { ChatPanel } from "@/components/chat-panel";

/**
 * Main workspace page.
 *
 * Layout (mirrors the UI prototype):
 *   - Sources sidebar is always visible
 *   - Parsed Content panel is conditional: shows when a source is selected
 *     or when a chat citation is clicked
 *   - Chat panel is hidden while a user is browsing source detail; shown
 *     when no source is selected or when a citation is being inspected
 *
 * This is still the shell — sources/chunks/messages arrive from their
 * real sources once N-001 through N-005 are wired.
 */
export default function Home() {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null);

  const showParsed = selectedSourceId !== null || focusedChunkId !== null;
  const showChat = selectedSourceId === null || focusedChunkId !== null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-muted/40">
      <TopNav />
      <div className="relative flex flex-1 overflow-hidden">
        <SourcesPanel
          selectedSourceId={selectedSourceId}
          onSelectSource={(id) => {
            setSelectedSourceId(id);
            setFocusedChunkId(null);
          }}
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
            onCitationClick={(cite) => {
              // Citations carry no chunkId in the retrieval shape; when we
              // wire this up, the page will also fetch the matching chunk
              // by (documentId, sectionPath) and scroll the ChunksPanel.
              setFocusedChunkId(cite.source.documentId ?? null);
              setSelectedSourceId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
