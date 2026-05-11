import { Effect } from "effect"

import { toChatMessageView, toChatThreadView } from "@/lib/chat-view"
import { DEMO_CHAT_MESSAGES } from "@/lib/demo-chat"
import { demoData } from "@/lib/demo-data"
import { notebookRequestContext } from "@/lib/notebook-request-context"
import { sourceViewOptionsBySourceId } from "@/lib/source-counts"
import { toSourceView } from "@/lib/source-view"
import {
  ensureDemoWorkspaceContent,
  listChatThreadsForWorkspace,
  listMessagesForThread,
  listSourcesForWorkspace,
} from "@/lib/workspace"
import { WorkspaceShell } from "@/components/workspace-shell"

export const dynamic = "force-dynamic"

/**
 * Main workspace page. Server component.
 *
 * Two modes:
 *   - Guest (no Dashboard session): shows static demo documents with parsed
 *     chunks so first-time visitors can explore the product before logging in.
 *     Upload and chat are gated behind Dashboard login.
 *   - Authenticated: the existing workspace flow — verify session,
 *     ensure workspace + API key, load real sources.
 */
export default async function Home() {
  const context = await notebookRequestContext.getOptionalAuthenticated()

  if (!context) {
    const guestContext = await notebookRequestContext.getGuest()
    return (
      <WorkspaceShell
        isGuest
        sources={demoData.listSources()}
        chatMessages={[...DEMO_CHAT_MESSAGES]}
        loginUrl={guestContext.loginUrl}
      />
    )
  }

  const { user, workspace } = context
  const { client } = await notebookRequestContext.getClientForWorkspace(
    workspace,
  )
  await ensureDemoWorkspaceContent(workspace, client)
  const sources = await listSourcesForWorkspace(workspace.id)
  const chatThreads = await listChatThreadsForWorkspace(workspace.id)
  const activeChatThread = chatThreads[0] ?? null
  const chatMessages = activeChatThread
    ? await listMessagesForThread(workspace.id, activeChatThread.id)
    : []
  const sourceOptions = await Effect.runPromise(
    sourceViewOptionsBySourceId(sources, client),
  )

  return (
    <WorkspaceShell
      user={{
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
      }}
      workspace={{
        id: workspace.id,
        namespace: workspace.namespace,
      }}
      sources={sources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      )}
      chatThreads={chatThreads.map(toChatThreadView)}
      activeChatThreadId={activeChatThread?.id ?? null}
      chatMessages={(chatMessages ?? []).map((message) =>
        toChatMessageView(message),
      )}
    />
  )
}
