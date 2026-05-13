import "server-only"

import { Effect } from "effect"

import { databaseRuntime } from "./database-runtime"
import { DbClient } from "@/infrastructure/db"
import { workspaceRepository } from "./repository"
import type { Workspace } from "@/infrastructure/db/schema"

type WorkspaceService = {
  readonly ensureWorkspaceEffect: (
    userId: string,
  ) => Effect.Effect<Workspace, never, DbClient>
  readonly pingDatabaseEffect: () => Effect.Effect<void, never, DbClient>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace>
  readonly pingDatabase: () => Promise<void>
}

const ensureWorkspaceEffect: WorkspaceService["ensureWorkspaceEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const existing = yield* workspaceRepository.findByUserIdEffect(userId)
    if (existing) return existing

    const namespace = `notebook-${crypto.randomUUID()}`
    yield* workspaceRepository.insertForUserEffect(userId, namespace)

    const row = yield* workspaceRepository.findByUserIdEffect(userId)
    if (!row) {
      return yield* Effect.die(
        new Error(
          `ensureWorkspace: workspace row not found for user ${userId} after ` +
            "upsert. Check that the workspaces.user_id unique index exists.",
        ),
      )
    }

    return row
  })

const pingDatabaseEffect: WorkspaceService["pingDatabaseEffect"] = () =>
  workspaceRepository.pingEffect()

const ensureWorkspace: WorkspaceService["ensureWorkspace"] = (userId: string) =>
  databaseRuntime.runPromise(ensureWorkspaceEffect(userId))

const pingDatabase: WorkspaceService["pingDatabase"] = () =>
  databaseRuntime.runPromise(pingDatabaseEffect())

export const workspaceService: WorkspaceService = {
  ensureWorkspaceEffect,
  pingDatabaseEffect,
  ensureWorkspace,
  pingDatabase,
}
