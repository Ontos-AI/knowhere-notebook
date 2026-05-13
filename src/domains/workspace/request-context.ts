import "server-only"

import { Effect } from "effect"
import { headers } from "next/headers"

import { ensureApiKeyForWorkspace } from "@/integrations/dashboard/api-key-service"
import { authURLs } from "@/infrastructure/auth/urls"
import {
  getCurrentUser,
  requireUser,
  type AuthUser,
} from "@/infrastructure/auth"
import { makeKnowhereClient } from "@/integrations/knowhere"
import { workspaceService } from "@/domains/workspace/service"
import type { Workspace } from "@/infrastructure/db/schema"

type NotebookClient = ReturnType<typeof makeKnowhereClient>

type AuthenticatedNotebookContext = {
  readonly user: AuthUser
  readonly workspace: Workspace
}

type AuthenticatedNotebookClientContext = AuthenticatedNotebookContext & {
  readonly apiKey: string
  readonly client: NotebookClient
}

type GuestNotebookContext = {
  readonly loginUrl: string
}

// ---------------------------------------------------------------------------
// Effect core
// ---------------------------------------------------------------------------

const getAuthenticatedEffect = Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => requireUser())
    const workspace = yield* Effect.tryPromise(() =>
      workspaceService.ensureWorkspace(user.id),
    )

    return { user, workspace }
  })

const getOptionalAuthenticatedEffect = Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => getCurrentUser())
    if (!user) return null

    const workspace = yield* Effect.tryPromise(() =>
      workspaceService.ensureWorkspace(user.id),
    )
    return { user, workspace }
  })

const getAuthenticatedWithClientEffect = Effect.gen(function* () {
    const context = yield* getAuthenticatedEffect
    const clientContext = yield* getClientForWorkspaceEffect(context.workspace)

    return {
      ...context,
      ...clientContext,
    }
  })

const getClientForWorkspaceEffect = (workspace: Workspace) =>
  Effect.gen(function* () {
    const cookieHeader =
      (yield* Effect.tryPromise(() => headers())).get("cookie") ?? ""
    const apiKey = yield* Effect.tryPromise(() =>
      ensureApiKeyForWorkspace(workspace.id, cookieHeader),
    )
    const client = makeKnowhereClient(apiKey)

    return { apiKey, client }
  })

const getGuestEffect = Effect.gen(function* () {
    const dashboardOrigin =
      process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000"
    const dashboardLoginURL = `${dashboardOrigin}/login`
    const headersList = yield* Effect.tryPromise(() => headers())
    const notebookPublicURL =
      process.env.NOTEBOOK_PUBLIC_URL ??
      authURLs.resolveNotebookPublicURLFromHeaders(headersList)
    const loginUrl = authURLs.buildDashboardLoginURL(
      dashboardLoginURL,
      notebookPublicURL,
    )

    return { loginUrl }
  },
)

// ---------------------------------------------------------------------------
// Async wrappers (backward-compatible)
// ---------------------------------------------------------------------------

async function getAuthenticated(): Promise<AuthenticatedNotebookContext> {
  return Effect.runPromise(getAuthenticatedEffect)
}

async function getOptionalAuthenticated(): Promise<AuthenticatedNotebookContext | null> {
  return Effect.runPromise(getOptionalAuthenticatedEffect)
}

async function getAuthenticatedWithClient(): Promise<AuthenticatedNotebookClientContext> {
  return Effect.runPromise(getAuthenticatedWithClientEffect)
}

async function getClientForWorkspace(
  workspace: Workspace,
): Promise<Pick<AuthenticatedNotebookClientContext, "apiKey" | "client">> {
  return Effect.runPromise(getClientForWorkspaceEffect(workspace))
}

async function getGuest(): Promise<GuestNotebookContext> {
  return Effect.runPromise(getGuestEffect)
}

export const notebookRequestContext = {
  getAuthenticated,
  getOptionalAuthenticated,
  getAuthenticatedWithClient,
  getClientForWorkspace,
  getGuest,
} as const
