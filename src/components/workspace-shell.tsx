"use client"

import { startTransition, useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
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

export const DESKTOP_PANEL_GUTTER_WIDTH = 8
export const DESKTOP_PANEL_MIN_WIDTHS = {
  sources: 260,
  chunks: 600,
  chat: 360,
} as const

const DESKTOP_PANEL_DEFAULT_WIDTHS = {
  sources: 320,
  chunks: 720,
  chat: 420,
} as const

type DesktopPanelKey = keyof typeof DESKTOP_PANEL_MIN_WIDTHS
type DesktopPanelWidths = Record<DesktopPanelKey, number>

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
  loginUrl?: string
}

export function WorkspaceShell({
  user,
  sources: initialSources,
  uploadAction,
  isGuest = false,
  loginUrl,
}: WorkspaceShellProps) {
  const initialSrcs = initialSources ?? []
  const initialSelectedSourceId = isGuest
    ? (initialSrcs.find((source) => source.status === "ready")?.id ?? null)
    : null

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    initialSelectedSourceId,
  )
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null)
  const [sources, setSources] = useState(initialSrcs)
  const [mobilePanel, setMobilePanel] = useState<PanelId>(
    isGuest ? "content" : "chat",
  )
  const [chat, setChat] = useState<ChatState>({
    threadId: null,
    messages: [],
    isSending: false,
    error: null,
  })
  const [chunkLoad, setChunkLoad] = useState<ChunkLoadState>({
    sourceId: initialSelectedSourceId,
    chunks: [],
    isLoading: initialSelectedSourceId !== null,
  })
  const loadedChunksBySourceId = useRef<Map<string, ParsedChunkView[]>>(
    new Map(),
  )
  const pendingChunkLoadsBySourceId = useRef<
    Map<string, Promise<ParsedChunkView[]>>
  >(new Map())
  const [desktopPanelWidths, setDesktopPanelWidths] =
    useState<DesktopPanelWidths>({ ...DESKTOP_PANEL_DEFAULT_WIDTHS })

  const minimumDesktopPanelWidth =
    DESKTOP_PANEL_MIN_WIDTHS.sources +
    DESKTOP_PANEL_MIN_WIDTHS.chunks +
    DESKTOP_PANEL_MIN_WIDTHS.chat +
    DESKTOP_PANEL_GUTTER_WIDTH * 2

  function redirectToLogin() {
    window.location.href = loginUrl ?? "/login"
  }

  const loadChunksForSource = useCallback(
    async (sourceId: string): Promise<ParsedChunkView[]> => {
      const loadedChunks = loadedChunksBySourceId.current.get(sourceId)
      if (loadedChunks) return loadedChunks

      const pendingLoad = pendingChunkLoadsBySourceId.current.get(sourceId)
      if (pendingLoad) return pendingLoad

      const load = fetchChunks(sourceId).then((chunks) => {
        loadedChunksBySourceId.current.set(sourceId, chunks)
        return chunks
      })
      pendingChunkLoadsBySourceId.current.set(sourceId, load)

      try {
        return await load
      } finally {
        pendingChunkLoadsBySourceId.current.delete(sourceId)
      }
    },
    [],
  )

  function handleDesktopPanelResize(
    leftPanel: DesktopPanelKey,
    rightPanel: DesktopPanelKey,
    deltaX: number,
  ): void {
    setDesktopPanelWidths((current) => {
      const totalWidth = current[leftPanel] + current[rightPanel]
      const leftMinimumWidth = DESKTOP_PANEL_MIN_WIDTHS[leftPanel]
      const rightMinimumWidth = DESKTOP_PANEL_MIN_WIDTHS[rightPanel]
      const leftWidth = clamp(
        current[leftPanel] + deltaX,
        leftMinimumWidth,
        totalWidth - rightMinimumWidth,
      )

      return {
        ...current,
        [leftPanel]: leftWidth,
        [rightPanel]: totalWidth - leftWidth,
      }
    })
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
    const sourceId = chunkLoad.sourceId
    if (!chunkLoad.isLoading || !sourceId) return

    let isCurrent = true
    startTransition(async () => {
      try {
        const chunks = await loadChunksForSource(sourceId)
        if (!isCurrent) return
        setChunkLoad({
          sourceId,
          chunks,
          isLoading: false,
        })
      } finally {
        if (isCurrent) {
          setChunkLoad((current) =>
            current.sourceId === sourceId
              ? { ...current, isLoading: false }
              : current,
          )
        }
      }
    })

    return () => {
      isCurrent = false
    }
  }, [chunkLoad.isLoading, chunkLoad.sourceId, loadChunksForSource])

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
    setFocusedChunkId(null)
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

    if (chunkLoad.sourceId === source.id && !chunkLoad.isLoading) {
      const focusedChunk = resolveCitationChunk(citation, chunkLoad.chunks)
      setFocusedChunkId(focusedChunk?.chunkId ?? null)
      return
    }

    setFocusedChunkId(null)
    setChunkLoad((current) =>
      current.sourceId === source.id && current.isLoading
        ? current
        : { sourceId: source.id, chunks: [], isLoading: true },
    )

    const chunks = await loadChunksForSource(source.id)
    const focusedChunk = resolveCitationChunk(citation, chunks)
    setChunkLoad({ sourceId: source.id, chunks, isLoading: false })
    setFocusedChunkId(focusedChunk?.chunkId ?? null)
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

      {/* Desktop: resizable three-panel strip with horizontal overflow at minimum widths. */}
      <div
        data-testid="desktop-panel-layout"
        className="relative hidden flex-1 overflow-x-auto overflow-y-hidden lg:block"
      >
        <div
          data-testid="desktop-resizable-panels"
          className="flex h-full"
          style={{
            minWidth: `${minimumDesktopPanelWidth}px`,
            width: "100%",
          }}
        >
          <div
            data-testid="desktop-sources-panel"
            className="h-full shrink-0"
            style={{
              minWidth: `${DESKTOP_PANEL_MIN_WIDTHS.sources}px`,
              width: `${desktopPanelWidths.sources}px`,
            }}
          >
            <SourcesPanel
              sources={sources}
              onSourceUploaded={isGuest ? undefined : handleSourceUploaded}
              selectedSourceId={selectedSourceId}
              onSelectSource={handleSourceSelected}
              onToggleIncluded={isGuest ? undefined : handleToggleIncluded}
              onArchiveSource={isGuest ? undefined : handleArchiveSource}
              uploadAction={isGuest ? undefined : uploadAction}
              onLoginClick={isGuest ? redirectToLogin : undefined}
            />
          </div>
          <DesktopResizeHandle
            label="Resize sources and parsed chunks"
            onResize={(deltaX) =>
              handleDesktopPanelResize("sources", "chunks", deltaX)
            }
          />
          <div
            data-testid="desktop-chunks-panel"
            className="h-full min-w-0 shrink-0 grow"
            style={{
              minWidth: `${DESKTOP_PANEL_MIN_WIDTHS.chunks}px`,
              width: `${desktopPanelWidths.chunks}px`,
            }}
          >
            <ChunksPanel
              chunks={chunkLoad.chunks}
              selectedSource={selectedSourceTitle}
              focusedChunkId={focusedChunkId}
              isLoading={chunkLoad.isLoading}
            />
          </div>
          <DesktopResizeHandle
            label="Resize parsed chunks and chat"
            onResize={(deltaX) =>
              handleDesktopPanelResize("chunks", "chat", deltaX)
            }
          />
          <div
            data-testid="desktop-chat-panel"
            className="h-full shrink-0"
            style={{
              minWidth: `${DESKTOP_PANEL_MIN_WIDTHS.chat}px`,
              width: `${desktopPanelWidths.chat}px`,
            }}
          >
            <ChatPanel
              messages={chat.messages}
              isDisabled={isGuest || readySourceCount === 0}
              isSending={chat.isSending}
              sourceCount={readySourceCount}
              onSend={handleChatSend}
              onCitationClick={handleCitationClick}
            />
          </div>
        </div>
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
          onSourceUploaded={isGuest ? undefined : handleSourceUploaded}
          selectedSourceId={selectedSourceId}
          onSelectSource={(id) => {
            handleSourceSelected(id)
            if (id) setMobilePanel("content")
          }}
          onToggleIncluded={isGuest ? undefined : handleToggleIncluded}
          onArchiveSource={isGuest ? undefined : handleArchiveSource}
          uploadAction={isGuest ? undefined : uploadAction}
          onLoginClick={isGuest ? redirectToLogin : undefined}
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
          isDisabled={isGuest || readySourceCount === 0}
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

function DesktopResizeHandle({
  label,
  onResize,
}: {
  label: string
  onResize: (deltaX: number) => void
}) {
  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    let lastClientX = event.clientX

    function handlePointerMove(moveEvent: PointerEvent): void {
      const deltaX = moveEvent.clientX - lastClientX
      lastClientX = moveEvent.clientX
      onResize(deltaX)
    }

    function handlePointerUp(): void {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className="group flex h-full shrink-0 cursor-col-resize items-center justify-center border-x border-transparent bg-border/40 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ width: `${DESKTOP_PANEL_GUTTER_WIDTH}px` }}
      onPointerDown={handlePointerDown}
    >
      <span className="h-10 w-0.5 rounded-full bg-muted-foreground/35 group-hover:bg-primary/60" />
    </button>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
