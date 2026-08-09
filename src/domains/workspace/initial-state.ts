import "server-only"

import { Effect } from "effect"

import type { ChatMessageView } from "@/domains/chat/types"
import type { ParsedChunkView } from "@/domains/chunks/types"
import { chatThreadService } from "@/domains/chat/thread-service"
import { toChatMessageView, toChatThreadView } from "@/domains/chat/view"
import { sourceViewOptionsBySourceId as getSourceViewOptionsBySourceId } from "@/domains/sources/counts"
import { localizeRemoteLibrarySources } from "@/domains/sources/remote-library"
import { reconcileSourcesForWorkspace as reconcileDefaultSourcesForWorkspace } from "@/domains/sources/reconcile"
import {
  startBackgroundReconciliation as defaultStartBackgroundReconciliation,
} from "@/domains/sources/background-reconcile"
import { sourceWorkflowRuntime } from "@/domains/sources/workflow-runtime"

import type { SourceView } from "@/domains/sources/types"
import { toSourceView } from "@/domains/sources/view"
import type { AuthUser } from "@/infrastructure/auth"
import type {
  ChatMessage,
  ChatThread,
  Source,
  Workspace,
} from "@/infrastructure/db/schema"
import { effectOperation } from "@/lib/effect-operation"
import { logger } from "@/lib/logger"
import { notebookRequestContext } from "./request-context"
import { workspaceRepository } from "./repository"
import { databaseRuntime } from "./database-runtime"
import { knowhereApiKeysRepository } from "@/infrastructure/auth/knowhere-api-keys-repository"

type WorkspaceShellInitialState = {
  readonly activeChatThreadId?: string | null
  readonly chatMessages?: ChatMessageView[]
  readonly chatThreads?: ReturnType<typeof toChatThreadView>[]
  readonly initialPrefetchedChunksBySourceId?: Record<string, ParsedChunkView[]>
  readonly sources?: SourceView[]
  readonly user?: {
    readonly id: string
    readonly name: string | null
    readonly email: string | null
  }
  readonly workspace?: {
    readonly id: string
    readonly namespace: string
    readonly activeKeyLabel: string | null
  }
  readonly workspaces?: readonly {
    readonly id: string
    readonly namespace: string
    readonly activeKeyLabel: string | null
  }[]
  readonly knowhereKeyLabels?: readonly {
    readonly id: string
    readonly label: string
    readonly mask: string
  }[]
  /** Whether Vercel Blob is configured (BLOB_READ_WRITE_TOKEN). When false,
   *  uploads use the direct multipart path to /api/sources. */
  readonly isBlobConfigured?: boolean
}

const workspaceInitialStateContext = "Workspace initial state"

type WorkspaceShellInitialStateClient =
  Parameters<typeof getSourceViewOptionsBySourceId>[1] &
  Parameters<typeof reconcileDefaultSourcesForWorkspace>[1] & {
    readonly documents: {
      readonly list: (params?: {
        readonly namespace?: string
      }) => Promise<{
        readonly documents: readonly {
          readonly documentId: string
          readonly namespace: string
          readonly status: string
          readonly sourceFileName?: string | null
          readonly documentMetadata?: Record<string, unknown>
        }[]
      }>
    }
  }

type WorkspaceShellInitialStateDependencies = {
  readonly getClientForWorkspace: (
    workspace: Workspace,
  ) => Promise<{
    readonly apiKey: string
    readonly client: WorkspaceShellInitialStateClient
  }>
  readonly getCurrentUser: () => Promise<AuthUser | null>
  readonly getOptionalAuthenticated: () => Promise<{
    readonly user: AuthUser
    readonly workspace: Workspace
  } | null>
  readonly listChatThreads: (
    workspaceId: string,
  ) => Promise<readonly ChatThread[]>
  readonly listMessages: (
    workspaceId: string,
    threadId: string,
  ) => Promise<readonly ChatMessage[] | null>
  readonly listSourcesForWorkspace: (
    workspaceId: string,
  ) => Promise<readonly Source[]>
  readonly listWorkspacesForUser: (
    userId: string,
  ) => Promise<readonly Workspace[]>
  readonly listMaskedKnowhereKeys: (userId: string) => Promise<
    readonly { id: string; label: string; mask: string }[]
  >
  readonly localizeRemoteDocument: typeof sourceWorkflowRuntime.localizeRemoteDocument
  readonly reconcileSourcesForWorkspace: (
    workspace: Workspace,
    client: WorkspaceShellInitialStateClient,
  ) => Promise<readonly Source[]>
  readonly startBackgroundReconciliation?: typeof defaultStartBackgroundReconciliation
  readonly sourceViewOptionsBySourceId: (
    sources: readonly Source[],
    client: WorkspaceShellInitialStateClient,
  ) => ReturnType<typeof getSourceViewOptionsBySourceId>
}

const defaultDependencies: WorkspaceShellInitialStateDependencies = {
  getClientForWorkspace: notebookRequestContext.getClientForWorkspace,
  getCurrentUser: notebookRequestContext.getCurrentUser,
  getOptionalAuthenticated: notebookRequestContext.getOptionalAuthenticated,
  listChatThreads: chatThreadService.listForWorkspace,
  listMessages: chatThreadService.listMessages,
  listSourcesForWorkspace: sourceWorkflowRuntime.listForWorkspace,
  listWorkspacesForUser: listAllForUser,
  listMaskedKnowhereKeys: listMaskedKnowhereKeysDefault,
  localizeRemoteDocument: sourceWorkflowRuntime.localizeRemoteDocument,
  reconcileSourcesForWorkspace: reconcileDefaultSourcesForWorkspace,
  startBackgroundReconciliation: defaultStartBackgroundReconciliation,
  sourceViewOptionsBySourceId: getSourceViewOptionsBySourceId,
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

export const loadWorkspaceShellInitialStateEffect = (
  deps: WorkspaceShellInitialStateDependencies = defaultDependencies,
) =>
  Effect.gen(function* () {
    const user = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "getCurrentUser",
      },
      () => deps.getCurrentUser(),
    )
    if (!user) {
      return {
        sources: [],
        workspaces: [],
        knowhereKeyLabels: [],
      }
    }

    const workspacesForUser = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "listWorkspacesForUser",
      },
      () => deps.listWorkspacesForUser(user.id),
    )

    const context = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "getOptionalAuthenticated",
      },
      () => deps.getOptionalAuthenticated(),
    )

    const userKeys = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "listMaskedKnowhereKeys",
      },
      () => deps.listMaskedKnowhereKeys(user.id),
    )
    const workspaceView = (row: Workspace) => ({
      id: row.id,
      namespace: row.namespace,
      activeKeyLabel:
        userKeys.find((key) => key.id === row.activeKnowhereApiKeyId)?.label ??
        null,
    })

    // Authenticated but no workspace yet: new users must add an API key and
    // pick a namespace before any workspace exists.
    if (!context) {
      return {
        user: {
          id: user.id,
          name: user.name ?? null,
          email: user.email ?? null,
        },
        workspace: undefined,
        workspaces: workspacesForUser.map(workspaceView),
        knowhereKeyLabels: userKeys,
        isBlobConfigured: isBlobConfigured(),
        sources: [],
      }
    }

    const { workspace } = context
    const listedSources = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "listSourcesForWorkspace",
      },
      () => deps.listSourcesForWorkspace(workspace.id),
    )
    const listedChatThreads = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "listChatThreads",
      },
      () => deps.listChatThreads(workspace.id),
    )
    const activeChatThread = listedChatThreads[0] ?? null
    const activeChatMessages = activeChatThread
      ? yield* effectOperation.tryPromise(
          {
            context: workspaceInitialStateContext,
            operation: "listMessages",
          },
          () => deps.listMessages(workspace.id, activeChatThread.id),
        )
      : []
    const chatMessages = activeChatMessages
      ? activeChatMessages.map((message) => toChatMessageView(message))
      : []
    const { client, apiKey } = yield* effectOperation.tryPromise(
      {
        context: workspaceInitialStateContext,
        operation: "getClientForWorkspace",
      },
      () => deps.getClientForWorkspace(workspace),
    )
    const sources = listedSources
    const workspaceSources = sources
    const localizedSources = yield* effectOperation.addContext(
      {
        context: workspaceInitialStateContext,
        operation: "localizeRemoteLibrarySources",
      },
      localizeRemoteLibrarySources({
        workspace,
        client,
        localSources: workspaceSources,
        localizeDocument: (document) =>
          deps.localizeRemoteDocument(workspace.id, {
            documentId: document.documentId,
            namespace: document.namespace,
            status: document.status,
            title: document.title,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes,
            revisionKey: document.revisionKey ?? null,
          }),
      }),
    )
    const sourcesNeedingKnowhereChunkCount =
      getWorkspaceSourcesNeedingKnowhereChunkCount(localizedSources)
    yield* Effect.sync(() =>
      triggerBackgroundReconciliationForParsingSources({
        workspaceId: workspace.id,
        sources,
        apiKey,
        startBackgroundReconciliation:
          deps.startBackgroundReconciliation ??
          defaultStartBackgroundReconciliation,
      }),
    )
    const sourceOptions = yield* effectOperation.addContext(
      {
        context: workspaceInitialStateContext,
        operation: "sourceViewOptionsBySourceId",
      },
      deps.sourceViewOptionsBySourceId(
        sourcesNeedingKnowhereChunkCount,
        client,
      ),
    )

    return {
      user: {
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
      },
      workspace: workspaceView(workspace),
      workspaces: workspacesForUser.map(workspaceView),
      knowhereKeyLabels: userKeys,
      isBlobConfigured: isBlobConfigured(),
      sources: localizedSources.map((source) =>
        toSourceView(source, sourceOptions.get(source.id)),
      ),
      chatThreads: listedChatThreads.map(toChatThreadView),
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

function listAllForUser(userId: string): Promise<readonly Workspace[]> {
  return databaseRuntime.runPromise(
    workspaceRepository.findAllByUserIdEffect(userId),
  )
}

/** True when Vercel Blob storage is configured (chunk cache + staged uploads). */
function isBlobConfigured(): boolean {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  return Boolean(token && token.length > 0)
}
function listMaskedKnowhereKeysDefault(
  userId: string,
): Promise<readonly { id: string; label: string; mask: string }[]> {
  return databaseRuntime
    .runPromise(knowhereApiKeysRepository.listByUserEffect(userId))
    .then((keys) =>
      keys.map((key) => ({
        id: key.id,
        label: key.label,
        mask: key.keyMask,
      })),
    )
}

function getWorkspaceSourcesNeedingKnowhereChunkCount(
  sources: readonly Source[],
): readonly Source[] {
  return sources.filter(
    (source) => source.status === "ready" && source.knowhereDocumentId,
  )
}

function triggerBackgroundReconciliationForParsingSources(input: {
  readonly workspaceId: string
  readonly sources: readonly Source[]
  readonly apiKey: string
  readonly startBackgroundReconciliation: typeof defaultStartBackgroundReconciliation
}): void {
  const parsingSources = input.sources.filter(
    (source) => source.status === "parsing" && source.knowhereJobId,
  )
  if (parsingSources.length === 0) return

  logger.info("initial-state: re-triggering reconciliation for parsing sources", {
    workspaceId: input.workspaceId,
    count: parsingSources.length,
    sourceIds: parsingSources.map((source) => source.id),
  })

  for (const source of parsingSources) {
    void input
      .startBackgroundReconciliation(input.workspaceId, source.id, input.apiKey)
      .catch((error: unknown) => {
        logger.warn("initial-state: background reconciliation trigger failed", {
          workspaceId: input.workspaceId,
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }
}
