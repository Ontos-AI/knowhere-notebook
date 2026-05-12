import "server-only"

import { Effect } from "effect"

import type { ChatMessageView } from "@/domains/chat/types"
import { demoView } from "@/domains/demo/view"
import { resolveWorkspaceDemoSources } from "@/domains/demo/workspace-source-resolution"
import { chatThreadService } from "@/domains/chat/thread-service"
import { toChatMessageView, toChatThreadView } from "@/domains/chat/view"
import { sourceViewOptionsBySourceId as getSourceViewOptionsBySourceId } from "@/domains/sources/counts"
import { reconcileSourcesForWorkspace as reconcileDefaultSourcesForWorkspace } from "@/domains/sources/reconcile"
import { sourceService } from "@/domains/sources/service"
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
  Parameters<typeof getSourceViewOptionsBySourceId>[1] &
    Parameters<typeof reconcileDefaultSourcesForWorkspace>[1]

type WorkspaceShellInitialStateDependencies = {
  readonly fetchDemoCatalog: () => Promise<DemoCatalog>
  readonly getClientForWorkspace: (
    workspace: Workspace,
  ) => Promise<{ readonly client: WorkspaceShellInitialStateClient }>
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
  readonly listChatThreads: (workspaceId: string) => Promise<readonly ChatThread[]>
  readonly listHiddenDemoSourceIds: (workspaceId: string) => Promise<string[]>
  readonly listMessages: (
    workspaceId: string,
    threadId: string,
  ) => Promise<readonly ChatMessage[] | null>
  readonly reconcileSourcesForWorkspace: (
    workspace: Workspace,
    client: WorkspaceShellInitialStateClient,
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
  reconcileSourcesForWorkspace: reconcileDefaultSourcesForWorkspace,
  sourceViewOptionsBySourceId: getSourceViewOptionsBySourceId,
}

const emptyDemoCatalog: DemoCatalog = { sources: [] }

export async function loadWorkspaceShellInitialState(
  deps: WorkspaceShellInitialStateDependencies = defaultDependencies,
): Promise<WorkspaceShellInitialState> {
  const context = await deps.getOptionalAuthenticated()

  if (!context) {
    const demoCatalog = await deps.fetchDemoCatalog()
    const guestContext = await deps.getGuest()
    return {
      isGuest: true,
      sources: demoCatalog.sources.map(demoView.toSourceView),
      chatMessages: demoView.toChatMessages(demoCatalog),
      dashboardUrl: resolveDashboardUrl(),
      loginUrl: guestContext.loginUrl,
    }
  }

  const { user, workspace } = context
  const demoCatalog = await fetchOptionalDemoCatalog(deps.fetchDemoCatalog)
  const { client } = await deps.getClientForWorkspace(workspace)
  const sources = await deps.reconcileSourcesForWorkspace(workspace, client)
  const demoSourceResolution = resolveWorkspaceDemoSources(
    sources,
    demoCatalog,
  )
  const hiddenDemoSourceIds = new Set(
    await deps.listHiddenDemoSourceIds(workspace.id),
  )
  const visibleDemoCatalogSources = demoCatalog.sources
    .filter(
      (source) =>
        !demoSourceResolution.materializedDemoSourceIds.has(source.demoSourceId),
    )
    .filter((source) => !hiddenDemoSourceIds.has(source.demoSourceId))
  const demoSources = visibleDemoCatalogSources.map(demoView.toSourceView)
  const listedChatThreads = await deps.listChatThreads(workspace.id)
  const seededDemoChatThread =
    listedChatThreads.length === 0
      ? await deps.ensureDemoChatThread(workspace.id, demoCatalog)
      : null
  const chatThreads = seededDemoChatThread
    ? [seededDemoChatThread.thread]
    : listedChatThreads
  const activeChatThread = chatThreads[0] ?? null
  const activeChatMessages = seededDemoChatThread
    ? seededDemoChatThread.messages
    : activeChatThread
      ? await deps.listMessages(workspace.id, activeChatThread.id)
      : []
  const chatMessages = activeChatMessages
    ? activeChatMessages.map(
        (message) => toChatMessageView(message),
      )
    : []
  const sourceOptions = await Effect.runPromise(
    deps.sourceViewOptionsBySourceId(demoSourceResolution.workspaceSources, client),
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
        toSourceView(source, sourceOptions.get(source.id)),
      ),
    ],
    chatThreads: chatThreads.map(toChatThreadView),
    activeChatThreadId: activeChatThread?.id ?? null,
    chatMessages,
  }
}

function resolveDashboardUrl(): string | undefined {
  return process.env.DASHBOARD_ORIGIN
}

async function fetchOptionalDemoCatalog(
  fetchDemoCatalog: () => Promise<DemoCatalog>,
): Promise<DemoCatalog> {
  try {
    return await fetchDemoCatalog()
  } catch {
    return emptyDemoCatalog
  }
}
