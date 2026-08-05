import "server-only"

import { Effect } from "effect"
import { cookies } from "next/headers"

import { databaseRuntime } from "./database-runtime"
import { DbClient } from "@/infrastructure/db"
import { workspaceRepository } from "./repository"
import type { Workspace } from "@/infrastructure/db/schema"

/** Cookie that holds the active workspace id for the current browser session. */
export const activeWorkspaceCookieName = "notebook-ws"

type WorkspaceService = {
  readonly ensureWorkspaceEffect: (
    userId: string,
  ) => Effect.Effect<Workspace | null, never, DbClient>
  readonly ensureWorkspaceForNamespaceEffect: (
    userId: string,
    namespace: string,
  ) => Effect.Effect<Workspace, never, DbClient>
  readonly pingDatabaseEffect: () => Effect.Effect<void, never, DbClient>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace | null>
  readonly ensureWorkspaceForNamespace: (
    userId: string,
    namespace: string,
  ) => Promise<Workspace>
  readonly pingDatabase: () => Promise<void>
}

/**
 * Resolve the workspace that should serve the current request.
 *
 * 1. If the `notebook-ws` cookie names a workspace owned by the user, use it.
 * 2. Otherwise use the user's first workspace.
 * 3. If the user has no workspace yet, return null — callers must decide how
 *    to handle the empty state (a new user must add an API key and pick a
 *    namespace before any workspace exists).
 */
const ensureWorkspaceEffect: WorkspaceService["ensureWorkspaceEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const activeId = yield* readActiveWorkspaceIdEffect.pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    )
    if (activeId) {
      const byCookie = yield* workspaceRepository.findByIdAndUserIdEffect(
        activeId,
        userId,
      )
      if (byCookie) return byCookie
    }

    const all = yield* workspaceRepository.findAllByUserIdEffect(userId)
    return all[0] ?? null
  })

/**
 * Find or create the workspace bound to a namespace for a user. Used by
 * the namespace picker when the user selects a namespace that has no
 * workspace row yet.
 */
const ensureWorkspaceForNamespaceEffect: WorkspaceService["ensureWorkspaceForNamespaceEffect"] =
  (userId: string, namespace: string) =>
    Effect.gen(function* () {
      const existing = yield* workspaceRepository.findByUserIdAndNamespaceEffect(
        userId,
        namespace,
      )
      if (existing) return existing

      yield* workspaceRepository.insertForUserNamespaceEffect(userId, namespace)

      const row = yield* workspaceRepository.findByUserIdAndNamespaceEffect(
        userId,
        namespace,
      )
      if (!row) {
        return yield* Effect.die(
          new Error(
            `ensureWorkspaceForNamespace: workspace row not found ` +
              `for user ${userId} (${namespace}) after upsert.`,
          ),
        )
      }

      return row
    })

const pingDatabaseEffect: WorkspaceService["pingDatabaseEffect"] = () =>
  workspaceRepository.pingEffect()

const ensureWorkspace: WorkspaceService["ensureWorkspace"] = (userId: string) =>
  databaseRuntime.runPromise(ensureWorkspaceEffect(userId))

const ensureWorkspaceForNamespace: WorkspaceService["ensureWorkspaceForNamespace"] =
  (userId: string, namespace: string) =>
    databaseRuntime.runPromise(
      ensureWorkspaceForNamespaceEffect(userId, namespace),
    )

const pingDatabase: WorkspaceService["pingDatabase"] = () =>
  databaseRuntime.runPromise(pingDatabaseEffect())

/**
 * Read the active workspace id from the `notebook-ws` cookie. Returns null
 * outside a request scope (background jobs, tests, CLI).
 */
const readActiveWorkspaceIdEffect: Effect.Effect<
  string | null,
  unknown,
  never
> = Effect.tryPromise(async (): Promise<string | null> => {
  try {
    const jar = await cookies()
    return jar.get(activeWorkspaceCookieName)?.value ?? null
  } catch {
    return null
  }
})

export const workspaceService: WorkspaceService = {
  ensureWorkspaceEffect,
  ensureWorkspaceForNamespaceEffect,
  pingDatabaseEffect,
  ensureWorkspace,
  ensureWorkspaceForNamespace,
  pingDatabase,
}
