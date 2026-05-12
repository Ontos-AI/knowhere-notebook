import "server-only"

import { Effect } from "effect"

import { chatRepository } from "../chat/repository"
import { databaseRuntime } from "./database-runtime"
import { DbClient } from "@/infrastructure/db"
import { demoData } from "../sources/demo-data"
import { sourceRepository } from "../sources/repository"
import { ensureDemoSourceUploadEffect } from "../sources/upload"
import type { UploadKnowhereClient } from "../sources/upload"
import { workspaceRepository } from "./repository"
import type { Workspace } from "@/infrastructure/db/schema"

type WorkspaceService = {
  readonly ensureWorkspaceEffect: (
    userId: string,
  ) => Effect.Effect<Workspace, never, DbClient>
  readonly ensureDemoWorkspaceContentEffect: (
    workspace: Workspace,
    knowhere: UploadKnowhereClient,
  ) => Effect.Effect<void, never, DbClient>
  readonly pingDatabaseEffect: () => Effect.Effect<void, never, DbClient>
  readonly ensureWorkspace: (userId: string) => Promise<Workspace>
  readonly ensureDemoWorkspaceContent: (
    workspace: Workspace,
    knowhere: UploadKnowhereClient,
  ) => Promise<void>
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

const ensureDemoWorkspaceContentEffect: WorkspaceService["ensureDemoWorkspaceContentEffect"] =
  (workspace: Workspace, knowhere: UploadKnowhereClient) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const repository = sourceRepository.createDemoUploadRepository(db)

      for (const seed of demoData.listSourceSeeds()) {
        const source = yield* ensureDemoSourceUploadEffect(workspace, seed, {
          knowhere,
          repository,
        })

        if (source?.status !== "ready" || !source.knowhereDocumentId) continue

        yield* chatRepository.ensureDemoThreadEffect(
          workspace.id,
          seed.demoKey,
          seed.chatThreadTitle,
          source.knowhereDocumentId,
        )
      }
    })

const pingDatabaseEffect: WorkspaceService["pingDatabaseEffect"] = () =>
  workspaceRepository.pingEffect()

const ensureWorkspace: WorkspaceService["ensureWorkspace"] = (userId: string) =>
  databaseRuntime.runPromise(ensureWorkspaceEffect(userId))

const ensureDemoWorkspaceContent: WorkspaceService["ensureDemoWorkspaceContent"] =
  (workspace: Workspace, knowhere: UploadKnowhereClient) =>
    databaseRuntime.runPromise(
      ensureDemoWorkspaceContentEffect(workspace, knowhere),
    )

const pingDatabase: WorkspaceService["pingDatabase"] = () =>
  databaseRuntime.runPromise(pingDatabaseEffect())

export const workspaceService: WorkspaceService = {
  ensureWorkspaceEffect,
  ensureDemoWorkspaceContentEffect,
  pingDatabaseEffect,
  ensureWorkspace,
  ensureDemoWorkspaceContent,
  pingDatabase,
}
