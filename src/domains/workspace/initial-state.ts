import "server-only"

import { Effect } from "effect"

import { DEMO_CHAT_MESSAGES } from "@/domains/chat/demo"
import type { ChatMessageView } from "@/domains/chat/types"
import { chatThreadService } from "@/domains/chat/thread-service"
import { toChatMessageView, toChatThreadView } from "@/domains/chat/view"
import { sourceViewOptionsBySourceId as getSourceViewOptionsBySourceId } from "@/domains/sources/counts"
import { demoData } from "@/domains/sources/demo-data"
import { reconcileSourcesForWorkspace as reconcileDefaultSourcesForWorkspace } from "@/domains/sources/reconcile"
import type { SourceView } from "@/domains/sources/types"
import { toSourceView } from "@/domains/sources/view"
import type { AuthUser } from "@/infrastructure/auth"
import type {
  ChatMessage,
  ChatThread,
  Source,
  Workspace,
} from "@/infrastructure/db/schema"
import { notebookRequestContext } from "./request-context"
import { workspaceService } from "./service"

type WorkspaceShellInitialState = {
  readonly activeChatThreadId?: string | null
  readonly chatMessages?: ChatMessageView[]
  readonly chatThreads?: ReturnType<typeof toChatThreadView>[]
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
  Parameters<typeof workspaceService.ensureDemoWorkspaceContent>[1] &
    Parameters<typeof getSourceViewOptionsBySourceId>[1] &
    Parameters<typeof reconcileDefaultSourcesForWorkspace>[1]

type WorkspaceShellInitialStateDependencies = {
  readonly demoChatMessages: readonly ChatMessageView[]
  readonly demoSources: readonly SourceView[]
  readonly ensureDemoWorkspaceContent: (
    workspace: Workspace,
    client: WorkspaceShellInitialStateClient,
  ) => Promise<void>
  readonly getClientForWorkspace: (
    workspace: Workspace,
  ) => Promise<{ readonly client: WorkspaceShellInitialStateClient }>
  readonly getGuest: () => Promise<{ readonly loginUrl: string }>
  readonly getOptionalAuthenticated: () => Promise<{
    readonly user: AuthUser
    readonly workspace: Workspace
  } | null>
  readonly listChatThreads: (workspaceId: string) => Promise<readonly ChatThread[]>
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
  demoChatMessages: DEMO_CHAT_MESSAGES,
  demoSources: demoData.listSources(),
  ensureDemoWorkspaceContent: workspaceService.ensureDemoWorkspaceContent,
  getClientForWorkspace: notebookRequestContext.getClientForWorkspace,
  getGuest: notebookRequestContext.getGuest,
  getOptionalAuthenticated: notebookRequestContext.getOptionalAuthenticated,
  listChatThreads: chatThreadService.listForWorkspace,
  listMessages: chatThreadService.listMessages,
  reconcileSourcesForWorkspace: reconcileDefaultSourcesForWorkspace,
  sourceViewOptionsBySourceId: getSourceViewOptionsBySourceId,
}

export async function loadWorkspaceShellInitialState(
  deps: WorkspaceShellInitialStateDependencies = defaultDependencies,
): Promise<WorkspaceShellInitialState> {
  const context = await deps.getOptionalAuthenticated()

  if (!context) {
    const guestContext = await deps.getGuest()
    return {
      isGuest: true,
      sources: [...deps.demoSources],
      chatMessages: [...deps.demoChatMessages],
      loginUrl: guestContext.loginUrl,
    }
  }

  const { user, workspace } = context
  const { client } = await deps.getClientForWorkspace(workspace)
  await deps.ensureDemoWorkspaceContent(workspace, client)
  const sources = await deps.reconcileSourcesForWorkspace(workspace, client)
  const chatThreads = await deps.listChatThreads(workspace.id)
  const activeChatThread = chatThreads[0] ?? null
  const chatMessages = activeChatThread
    ? await deps.listMessages(workspace.id, activeChatThread.id)
    : []
  const sourceOptions = await Effect.runPromise(
    deps.sourceViewOptionsBySourceId(sources, client),
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
    sources: sources.map((source) =>
      toSourceView(source, sourceOptions.get(source.id)),
    ),
    chatThreads: chatThreads.map(toChatThreadView),
    activeChatThreadId: activeChatThread?.id ?? null,
    chatMessages: (chatMessages ?? []).map((message) =>
      toChatMessageView(message),
    ),
  }
}
