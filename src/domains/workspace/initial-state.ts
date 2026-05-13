import "server-only"

import { Effect } from "effect"

import type { ChatMessageView } from "@/domains/chat/types"
import { demoView } from "@/domains/demo/view"
import {
  getMaterializedDemoSourceViewOptionsBySourceId,
  getWorkspaceSourcesNeedingKnowhereChunkCount,
  resolveWorkspaceDemoSources,
} from "@/domains/demo/workspace-source-resolution"
import { chatThreadService } from "@/domains/chat/thread-service"
import { toChatMessageView, toChatThreadView } from "@/domains/chat/view"
import { sourceViewOptionsBySourceId as getSourceViewOptionsBySourceId } from "@/domains/sources/counts"
import { sourceService } from "@/domains/sources/service"
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"
import { reconcileStaleSources } from "@/domains/sources/background-reconcile"
import type { SourceView } from "@/domains/sources/types"
import { toSourceView } from "@/domains/sources/view"
import type { AuthUser } from "@/infrastructure/auth"
import type {
  ChatMessage,
  ChatThread,
  Source,
  Workspace,
} from "@/infrastructure/db/schema"
import { knowhereDemoApi, type DemoCatalog } from "@/integrations/knowhere-demo"
import { notebookRequestContext } from "./request-context"

type WorkspaceShellInitialState = {
  readonly activeChatThreadId?: string | null
  readonly chatMessages?: ChatMessageView[]
  readonly chatThreads?: ReturnType<typeof toChatThreadView>[]
  readonly dashboardUrl?: string
  readonly isGuest?: boolean
  readonly loginUrl?: string
  readonly sources?: SourceView[]
  readonly user?: {
    readonly id: string
    readonly name: string | null
    readonly email: string | null
  }
  readonly workspace?: {
    readonly id: string
    readonly namespace: string
  }
}

type WorkspaceShellInitialStateClient =
  Parameters<typeof getSourceViewOptionsBySourceId>[1]

type WorkspaceShellInitialStateDependencies = {
  readonly fetchDemoCatalog: () => Promise<DemoCatalog>
  readonly getClientForWorkspace: (
    workspace: Workspace,
  ) => Promise<{
    readonly apiKey: string
    readonly client: WorkspaceShellInitialStateClient
  }>
  readonly getGuest: () => Promise<{ readonly loginUrl: string }>
  readonly getOptionalAuthenticated: () => Promise<{
    readonly user: AuthUser
    readonly workspace: Workspace
  } | null>
  readonly ensureDemoChatThread: (
    workspaceId: string,
    catalog: DemoCatalog,
  ) => Promise<{
    readonly thread: ChatThread
    readonly messages: readonly ChatMessage[]
  } | null>
  readonly listChatThreads: (
    workspaceId: string,
  ) => Promise<readonly ChatThread[]>
  readonly listHiddenDemoSourceIds: (workspaceId: string) => Promise<string[]>
  readonly listMessages: (
    workspaceId: string,
    threadId: string,
  ) => Promise<readonly ChatMessage[] | null>
  readonly listSourcesForWorkspace: (
    workspaceId: string,
  ) => Promise<readonly Source[]>
  readonly sourceViewOptionsBySourceId: (
    sources: readonly Source[],
    client: WorkspaceShellInitialStateClient,
  ) => ReturnType<typeof getSourceViewOptionsBySourceId>
}

const defaultDependencies: WorkspaceShellInitialStateDependencies = {
  fetchDemoCatalog: knowhereDemoApi.fetchCatalog,
  getClientForWorkspace: notebookRequestContext.getClientForWorkspace,
  getGuest: notebookRequestContext.getGuest,
  getOptionalAuthenticated: notebookRequestContext.getOptionalAuthenticated,
  ensureDemoChatThread: chatThreadService.ensureDemo,
  listChatThreads: chatThreadService.listForWorkspace,
  listHiddenDemoSourceIds: sourceService.listHiddenDemoSourceIds,
  listMessages: chatThreadService.listMessages,
  listSourcesForWorkspace: sourceWorkflowRuntime.listForWorkspace,
  sourceViewOptionsBySourceId: getSourceViewOptionsBySourceId,
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

export const loadWorkspaceShellInitialStateEffect = (
  deps: WorkspaceShellInitialStateDependencies = defaultDependencies,
) =>
  Effect.gen(function* () {
    const context = yield* Effect.tryPromise(() =>
      deps.getOptionalAuthenticated(),
    )

    if (!context) {
      const demoCatalog = yield* Effect.tryPromise(() =>
        deps.fetchDemoCatalog(),
      )
      const guestContext = yield* Effect.tryPromise(() => deps.getGuest())
      return {
        isGuest: true,
        sources: demoCatalog.sources.map(demoView.toSourceView),
        chatMessages: demoView.toChatMessages(demoCatalog),
        dashboardUrl: resolveDashboardUrl(),
        loginUrl: guestContext.loginUrl,
      }
    }

    const { user, workspace } = context
    const demoCatalog = yield* Effect.tryPromise(() =>
      knowhereDemoApi.fetchOptionalCatalog(deps.fetchDemoCatalog),
    )
    const sources = yield* Effect.tryPromise(() =>
      deps.listSourcesForWorkspace(workspace.id),
    )
    const demoSourceResolution = resolveWorkspaceDemoSources(
      sources,
      demoCatalog,
    )
    const hiddenDemoSourceIds = new Set(
      yield* Effect.tryPromise(() =>
        deps.listHiddenDemoSourceIds(workspace.id),
      ),
    )
    const visibleDemoCatalogSources = demoCatalog.sources
      .filter(
        (source) =>
          !demoSourceResolution.materializedDemoSourceIds.has(
            source.demoSourceId,
          ),
      )
      .filter((source) => !hiddenDemoSourceIds.has(source.demoSourceId))
    const demoSources = visibleDemoCatalogSources.map(demoView.toSourceView)
    const listedChatThreads = yield* Effect.tryPromise(() =>
      deps.listChatThreads(workspace.id),
    )
    const seededDemoChatThread =
      listedChatThreads.length === 0
        ? yield* Effect.tryPromise(() =>
            deps.ensureDemoChatThread(workspace.id, demoCatalog),
          )
        : null
    const chatThreads = seededDemoChatThread
      ? [seededDemoChatThread.thread]
      : listedChatThreads
    const activeChatThread = chatThreads[0] ?? null
    const activeChatMessages = seededDemoChatThread
      ? seededDemoChatThread.messages
      : activeChatThread
        ? yield* Effect.tryPromise(() =>
            deps.listMessages(workspace.id, activeChatThread.id),
          )
        : []
    const chatMessages = activeChatMessages
      ? activeChatMessages.map((message) => toChatMessageView(message))
      : []
    const sourcesNeedingKnowhereChunkCount =
      getWorkspaceSourcesNeedingKnowhereChunkCount(
        demoSourceResolution.workspaceSources,
      )
    const materializedDemoSourceOptions =
      getMaterializedDemoSourceViewOptionsBySourceId(
        demoSourceResolution.workspaceSources,
        demoCatalog,
      )
    const { client, apiKey } = yield* Effect.tryPromise(() =>
      deps.getClientForWorkspace(workspace),
    )
    yield* Effect.fork(
      Effect.tryPromise(() => reconcileStaleSources(workspace.id, apiKey)),
    )
    const sourceOptions = yield* deps.sourceViewOptionsBySourceId(
      sourcesNeedingKnowhereChunkCount,
      client,
    )

    return {
      user: {
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
      },
      workspace: {
        id: workspace.id,
        namespace: workspace.namespace,
      },
      dashboardUrl: resolveDashboardUrl(),
      sources: [
        ...demoSources,
        ...demoSourceResolution.workspaceSources.map((source) =>
          toSourceView(
            source,
            materializedDemoSourceOptions.get(source.id) ??
              sourceOptions.get(source.id),
          ),
        ),
      ],
      chatThreads: chatThreads.map(toChatThreadView),
      activeChatThreadId: activeChatThread?.id ?? null,
      chatMessages,
    }
  })

// ---------------------------------------------------------------------------
// Async wrapper (backward-compatible)
// ---------------------------------------------------------------------------

export async function loadWorkspaceShellInitialState(
  deps: WorkspaceShellInitialStateDependencies = defaultDependencies,
): Promise<WorkspaceShellInitialState> {
  return Effect.runPromise(loadWorkspaceShellInitialStateEffect(deps))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDashboardUrl(): string | undefined {
  return process.env.DASHBOARD_ORIGIN
}
