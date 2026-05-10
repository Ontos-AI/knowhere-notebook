"use client"

import { startTransition, useEffect, useState } from "react"
import { Effect } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { TopNav } from "@/components/top-nav"
import { SourcesPanel } from "@/components/sources-panel"
import { ChunksPanel } from "@/components/chunks-panel"
import { ChatPanel } from "@/components/chat-panel"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { resolveCitationChunk } from "@/lib/chunks"
import { useHashFragment } from "@/lib/use-hash-fragment"
import type {
  ChatCitationView,
  ChatMessageView,
  ParsedChunkView,
  SourceView,
} from "@/lib/types"
import type { UploadSourceActionState } from "@/app/actions"

const getJson = <T,>(url: string) =>
  Effect.runPromise(
    Effect.flatMap(
      HttpClientRequest.get(url).pipe(HttpClient.execute),
      (res) => res.json,
    ).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

const postJson = <T,>(url: string, body: unknown) =>
  Effect.runPromise(
    Effect.flatMap(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.bodyText(JSON.stringify(body)),
        HttpClient.execute,
      ),
      (res) => res.json,
    ).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

const patchJson = <T,>(url: string, body: unknown) =>
  Effect.runPromise(
    Effect.flatMap(
      HttpClientRequest.patch(url).pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.bodyText(JSON.stringify(body)),
        HttpClient.execute,
      ),
      (res) => res.json,
    ).pipe(Effect.provide(FetchHttpClient.layer)) as Effect.Effect<T>,
  )

export type PanelId = "sources" | "content" | "chat"

type ChunkLoadState = {
  sourceId: string | null
  chunks: ParsedChunkView[]
  isLoading: boolean
}

type ChatState = {
  threadId: string | null
  messages: ChatMessageView[]
  isSending: boolean
  error: string | null
}

export type WorkspaceShellProps = {
  user?: {
    id: string
    name: string | null
    email: string | null
  }
  workspace?: {
    id: string
    namespace: string
  }
  sources?: SourceView[]
  uploadAction?: (
    state: UploadSourceActionState,
    formData: FormData,
  ) => Promise<UploadSourceActionState>
  isGuest?: boolean
  demoSource?: SourceView
  demoChunks?: ParsedChunkView[]
  loginUrl?: string
}

export function WorkspaceShell({
  user,
  sources: initialSources,
  uploadAction,
  isGuest = false,
  demoSource,
  demoChunks,
  loginUrl,
}: WorkspaceShellProps) {
  const guestSources = demoSource ? [demoSource] : []
  const guestChunks = demoChunks ?? []
  const initialSrcs = isGuest ? guestSources : (initialSources ?? [])

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [focusedChunkId, navigateToChunk] = useHashFragment()
  const [sources, setSources] = useState(initialSrcs)
  const [mobilePanel, setMobilePanel] = useState<PanelId>("chat")
  const [chat, setChat] = useState<ChatState>({
    threadId: null,
    messages: [],
    isSending: false,
    error: null,
  })
  const [chunkLoad, setChunkLoad] = useState<ChunkLoadState>({
    sourceId: null,
    chunks: isGuest ? guestChunks : [],
    isLoading: false,
  })

  function redirectToLogin() {
    window.location.href = loginUrl ?? "/login"
  }

  useEffect(() => {
    const hasPendingSources = sources.some(
      (source) => source.status === "uploading" || source.status === "parsing",
    )
    if (!hasPendingSources) return

    const interval = window.setInterval(() => {
      startTransition(async () => {
        try {
          const body = await getJson<{ sources?: SourceView[] }>(
            "/api/sources",
          )
          if (!Array.isArray(body.sources)) return
          const refreshedSources = body.sources

          setSources((current) =>
            mergeSourceQueryState(refreshedSources, current),
          )
          const selectedSource = refreshedSources.find(
            (source) => source.id === selectedSourceId,
          )
          if (
            selectedSource &&
            selectedSource.status === "ready" &&
            chunkLoad.sourceId !== selectedSource.id
          ) {
            setChunkLoad({
              sourceId: selectedSource.id,
              chunks: [],
              isLoading: true,
            })
          }
        } catch {
          // Poll interval — silently ignore transient errors.
        }
      })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [chunkLoad.sourceId, selectedSourceId, sources])

  useEffect(() => {
    if (!chunkLoad.isLoading || !chunkLoad.sourceId) return

    let isCurrent = true
    startTransition(async () => {
      try {
        const body = await getJson<{ chunks?: ParsedChunkView[] }>(
          `/api/sources/${encodeURIComponent(chunkLoad.sourceId!)}/chunks`,
        )
        if (!isCurrent) return
        setChunkLoad({
          sourceId: chunkLoad.sourceId,
          chunks: Array.isArray(body.chunks) ? body.chunks : [],
          isLoading: false,
        })
      } finally {
        if (isCurrent) {
          setChunkLoad((current) =>
            current.sourceId === chunkLoad.sourceId
              ? { ...current, isLoading: false }
              : current,
          )
        }
      }
    })

    return () => {
      isCurrent = false
    }
  }, [chunkLoad.isLoading, chunkLoad.sourceId])

  const selectedSourceTitle =
    sources.find((source) => source.id === selectedSourceId)?.title ?? null

  function handleSourceUploaded(source: SourceView) {
    setSources((current) => [
      source,
      ...current.filter((candidate) => candidate.id !== source.id),
    ])
  }

  function handleToggleIncluded(sourceId: string, included: boolean) {
    setSources((current) =>
      current.map((source) =>
        source.id === sourceId
          ? { ...source, excludedFromQuery: !included }
          : source,
      ),
    )
  }

  async function handleArchiveSource(sourceId: string) {
    try {
      await patchJson(`/api/sources/${encodeURIComponent(sourceId)}`, {
        archived: true,
      })
      setSources((current) =>
        current.filter((source) => source.id !== sourceId),
      )
      setSelectedSourceId((current) =>
        current === sourceId ? null : current,
      )
    } catch {
      // Silently ignore — the source stays in the list.
    }
  }

  function handleSourceSelected(sourceId: string | null) {
    setSelectedSourceId(sourceId)
    navigateToChunk(null)
    setChunkLoad({ sourceId: null, chunks: [], isLoading: false })

    if (!sourceId) return

    const source = sources.find((candidate) => candidate.id === sourceId)
    if (!source || source.status !== "ready") return

    setChunkLoad({ sourceId, chunks: [], isLoading: true })
  }

  async function handleChatSend(text: string) {
    const optimisticId = `pending-${Date.now()}`
    const optimisticUser: ChatMessageView = {
      id: optimisticId,
      role: "user",
      content: text,
    }
    setChat((current) => ({
      ...current,
      isSending: true,
      error: null,
      messages: [...current.messages, optimisticUser],
    }))
    try {
      const body = await postJson<{
        threadId?: string
        messages?: ChatMessageView[]
        message?: string
      }>("/api/chat", {
        message: text,
        threadId: chat.threadId ?? undefined,
        excludedSourceIds: sources
          .filter((source) => source.excludedFromQuery)
          .map((source) => source.id),
      })

      if (!body.threadId || !Array.isArray(body.messages)) {
        setChat((current) => ({
          ...current,
          isSending: false,
          messages: current.messages.filter((m) => m.id !== optimisticId),
          error: body.message ?? "The assistant could not answer right now.",
        }))
        return
      }

      setChat((current) => {
        const assistantMessages = body.messages!.filter(
          (m) => m.role === "assistant",
        )
        return {
          threadId: body.threadId ?? current.threadId,
          messages: [...current.messages, ...assistantMessages],
          isSending: false,
          error: null,
        }
      })
    } catch {
      setChat((current) => ({
        ...current,
        isSending: false,
        messages: current.messages.filter((m) => m.id !== optimisticId),
        error: "The assistant could not answer right now.",
      }))
    }
  }

  async function handleCitationClick(citation: ChatCitationView) {
    const source = sources.find(
      (candidate) => candidate.documentId === citation.source.documentId,
    )
    if (!source) return

    setSelectedSourceId(source.id)
    navigateToChunk(null)
    setChunkLoad({ sourceId: source.id, chunks: [], isLoading: true })

    const chunks = await fetchChunks(source.id)
    const focusedChunk = resolveCitationChunk(citation, chunks)
    setChunkLoad({ sourceId: source.id, chunks, isLoading: false })
    navigateToChunk(focusedChunk?.chunkId ?? null)
  }

  const readySourceCount = sources.filter(
    (source) => source.status === "ready",
  ).length

  const hasMessages = chat.messages.length > 0

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <TopNav
        userInitials={user ? initialsOf(user) : undefined}
        userName={user ? (user.name ?? user.email ?? undefined) : undefined}
      />

      {/* Desktop: three-panel side-by-side layout — always all three visible */}
      <div className="relative hidden flex-1 overflow-hidden lg:flex">
        <SourcesPanel
          sources={sources}
          onSourceUploaded={isGuest ? undefined : handleSourceUploaded}
          selectedSourceId={selectedSourceId}
          onSelectSource={(id) => {
            if (isGuest) {
              setSelectedSourceId(id)
              navigateToChunk(null)
              setChunkLoad({
                sourceId: id,
                chunks: id ? guestChunks : [],
                isLoading: false,
              })
              return
            }
            handleSourceSelected(id)
          }}
          onToggleIncluded={isGuest ? undefined : handleToggleIncluded}
          onArchiveSource={isGuest ? undefined : handleArchiveSource}
          uploadAction={isGuest ? undefined : uploadAction}
          onLoginClick={isGuest ? redirectToLogin : undefined}
        />
        <ChunksPanel
          chunks={chunkLoad.chunks}
          selectedSource={selectedSourceTitle}
          focusedChunkId={focusedChunkId}
          isLoading={chunkLoad.isLoading}
        />
        <ChatPanel
          messages={chat.messages}
          isDisabled={isGuest || readySourceCount === 0}
          isSending={chat.isSending}
          sourceCount={readySourceCount}
          onSend={handleChatSend}
          onCitationClick={handleCitationClick}
        />
      </div>

      {/* Mobile: single-panel with bottom tab bar. */}
      <div
        id="panel-sources"
        role="tabpanel"
        aria-labelledby="tab-sources"
        className={`lg:hidden flex-1 overflow-hidden pb-14 ${
          mobilePanel === "sources" ? "flex flex-col" : "hidden"
        }`}
      >
        <SourcesPanel
          sources={sources}
          onSourceUploaded={handleSourceUploaded}
          selectedSourceId={selectedSourceId}
          onSelectSource={(id) => {
            handleSourceSelected(id)
            if (id) setMobilePanel("content")
          }}
          onToggleIncluded={handleToggleIncluded}
          onArchiveSource={handleArchiveSource}
          uploadAction={uploadAction}
        />
      </div>
      <div
        id="panel-content"
        role="tabpanel"
        aria-labelledby="tab-content"
        className={`lg:hidden flex-1 overflow-hidden pb-14 ${
          mobilePanel === "content" ? "flex flex-col" : "hidden"
        }`}
      >
        <ChunksPanel
          chunks={chunkLoad.chunks}
          selectedSource={selectedSourceTitle}
          focusedChunkId={focusedChunkId}
          isLoading={chunkLoad.isLoading}
        />
      </div>
      <div
        id="panel-chat"
        role="tabpanel"
        aria-labelledby="tab-chat"
        className={`lg:hidden flex-1 overflow-hidden pb-14 ${
          mobilePanel === "chat" ? "flex flex-col" : "hidden"
        }`}
      >
        <ChatPanel
          messages={chat.messages}
          isDisabled={readySourceCount === 0}
          isSending={chat.isSending}
          sourceCount={readySourceCount}
          onSend={handleChatSend}
          onCitationClick={(citation) => {
            setMobilePanel("content")
            handleCitationClick(citation)
          }}
        />
      </div>

      <MobileTabBar
        activePanel={mobilePanel}
        onPanelChange={setMobilePanel}
        sourceCount={sources.filter((s) => s.status === "ready").length}
        chunkCount={chunkLoad.chunks.length}
        hasMessages={hasMessages}
      />

      {chat.error && (
        <div className="fixed bottom-18 right-4 z-50 max-w-sm rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-lg lg:bottom-4">
          {chat.error}
        </div>
      )}
    </div>
  )
}

async function fetchChunks(sourceId: string): Promise<ParsedChunkView[]> {
  try {
    const body = await getJson<{ chunks?: ParsedChunkView[] }>(
      `/api/sources/${encodeURIComponent(sourceId)}/chunks`,
    )
    return Array.isArray(body.chunks) ? body.chunks : []
  } catch {
    return []
  }
}

function mergeSourceQueryState(
  nextSources: readonly SourceView[],
  currentSources: readonly SourceView[],
): SourceView[] {
  const currentById = new Map(
    currentSources.map((source) => [source.id, source.excludedFromQuery]),
  )
  return nextSources.map((source) => ({
    ...source,
    excludedFromQuery: currentById.get(source.id) ?? source.excludedFromQuery,
  }))
}

function initialsOf(user: WorkspaceShellProps["user"]): string {
  if (!user) return "?"
  const source = user.name ?? user.email ?? user.id
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0][0]!.toUpperCase()
  return (parts[0][0]! + parts[1][0]!).toUpperCase()
}
