import "server-only"

import { headers } from "next/headers"

import { ensureApiKeyForWorkspace } from "@/integrations/dashboard/api-key-service"
import { authURLs } from "@/infrastructure/auth/urls"
import { getCurrentUser, requireUser, type AuthUser } from "@/infrastructure/auth"
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

async function getAuthenticated(): Promise<AuthenticatedNotebookContext> {
  const user = await requireUser()
  const workspace = await workspaceService.ensureWorkspace(user.id)

  return { user, workspace }
}

async function getOptionalAuthenticated(): Promise<AuthenticatedNotebookContext | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const workspace = await workspaceService.ensureWorkspace(user.id)
  return { user, workspace }
}

async function getAuthenticatedWithClient(): Promise<AuthenticatedNotebookClientContext> {
  const context = await getAuthenticated()
  const clientContext = await getClientForWorkspace(context.workspace)

  return {
    ...context,
    ...clientContext,
  }
}

async function getClientForWorkspace(
  workspace: Workspace,
): Promise<Pick<AuthenticatedNotebookClientContext, "apiKey" | "client">> {
  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = makeKnowhereClient(apiKey)

  return { apiKey, client }
}

async function getGuest(): Promise<GuestNotebookContext> {
  const dashboardOrigin =
    process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000"
  const dashboardLoginURL = `${dashboardOrigin}/login`
  const notebookPublicURL =
    process.env.NOTEBOOK_PUBLIC_URL ??
    authURLs.resolveNotebookPublicURLFromHeaders(await headers())
  const loginUrl = authURLs.buildDashboardLoginURL(
    dashboardLoginURL,
    notebookPublicURL,
  )

  return { loginUrl }
}

export const notebookRequestContext = {
  getAuthenticated,
  getOptionalAuthenticated,
  getAuthenticatedWithClient,
  getClientForWorkspace,
  getGuest,
} as const
