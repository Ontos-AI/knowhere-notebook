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
  ) => Effect.Effect<Workspace, never, DbClient>
  readonly ensureWorkspaceForLabelAndNamespaceEffect: (
    userId: string,
    keyLabel: string,
    namespace: string,
  ) => Effect.Effect<Workspace, never, DbClient>
  readonly pingDatabaseEffect: () => Effect.Effect<void, never, DbClient>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace>
  readonly ensureWorkspaceForLabelAndNamespace: (
    userId: string,
    keyLabel: string,
    namespace: string,
  ) => Promise<Workspace>
  readonly pingDatabase: () => Promise<void>
}

/**
 * Resolve the workspace that should serve the current request.
 *
 * 1. If the `notebook-ws` cookie names a workspace owned by the user, use it.
 * 2. Otherwise use the user's first workspace (legacy single-workspace
 *    behavior: existing rows keep working).
 * 3. If the user has no workspace yet, create a legacy default one
 *    (null key label, auto-generated `notebook-<uuid>` namespace).
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
    if (all.length > 0) return all[0]!

    const namespace = `notebook-${crypto.randomUUID()}`
    yield* workspaceRepository.insertForUserLabelNamespaceEffect(
      userId,
      null,
      namespace,
    )

    const legacyRows = yield* workspaceRepository.findAllByUserIdEffect(userId)
    const row = legacyRows[0]
    if (row) return row

    return yield* Effect.die(
      new Error(
        `ensureWorkspace: workspace row not found for user ${userId} after ` +
          "upsert. Check that the workspaces indexes exist.",
      ),
    )
  })

/**
 * Find or create the workspace bound to a specific (keyLabel, namespace)
 * pair for a user. Used by the domain switcher when the user picks a
 * namespace under a domain that has no workspace row yet.
 */
const ensureWorkspaceForLabelAndNamespaceEffect: WorkspaceService["ensureWorkspaceForLabelAndNamespaceEffect"] =
  (userId: string, keyLabel: string, namespace: string) =>
    Effect.gen(function* () {
      const existing =
        yield* workspaceRepository.findByUserIdAndLabelAndNamespaceEffect(
          userId,
          keyLabel,
          namespace,
        )
      if (existing) return existing

      yield* workspaceRepository.insertForUserLabelNamespaceEffect(
        userId,
        keyLabel,
        namespace,
      )

      const row =
        yield* workspaceRepository.findByUserIdAndLabelAndNamespaceEffect(
          userId,
          keyLabel,
          namespace,
        )
      if (!row) {
        return yield* Effect.die(
          new Error(
            `ensureWorkspaceForLabelAndNamespace: workspace row not found ` +
              `for user ${userId} (${keyLabel}, ${namespace}) after upsert.`,
          ),
        )
      }

      return row
    })

const pingDatabaseEffect: WorkspaceService["pingDatabaseEffect"] = () =>
  workspaceRepository.pingEffect()

const ensureWorkspace: WorkspaceService["ensureWorkspace"] = (userId: string) =>
  databaseRuntime.runPromise(ensureWorkspaceEffect(userId))

const ensureWorkspaceForLabelAndNamespace: WorkspaceService["ensureWorkspaceForLabelAndNamespace"] =
  (userId: string, keyLabel: string, namespace: string) =>
    databaseRuntime.runPromise(
      ensureWorkspaceForLabelAndNamespaceEffect(userId, keyLabel, namespace),
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
  ensureWorkspaceForLabelAndNamespaceEffect,
  pingDatabaseEffect,
  ensureWorkspace,
  ensureWorkspaceForLabelAndNamespace,
  pingDatabase,
}
