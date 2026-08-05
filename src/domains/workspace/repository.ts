import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import { workspaces, type Workspace } from "@/infrastructure/db/schema"

type WorkspaceRepository = {
  readonly findAllByUserIdEffect: (
    userId: string,
  ) => Effect.Effect<Workspace[], never, DbClient>
  readonly findByIdEffect: (
    id: string,
  ) => Effect.Effect<Workspace | null, never, DbClient>
  readonly findByIdAndUserIdEffect: (
    id: string,
    userId: string,
  ) => Effect.Effect<Workspace | null, never, DbClient>
  readonly findByUserIdAndLabelAndNamespaceEffect: (
    userId: string,
    keyLabel: string,
    namespace: string,
  ) => Effect.Effect<Workspace | null, never, DbClient>
  readonly insertForUserLabelNamespaceEffect: (
    userId: string,
    keyLabel: string | null,
    namespace: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly pingEffect: () => Effect.Effect<void, never, DbClient>
}

const findAllByUserIdEffect: WorkspaceRepository["findAllByUserIdEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .orderBy(workspaces.createdAt),
    )
  })

const findByIdEffect: WorkspaceRepository["findByIdEffect"] = (id: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .limit(1),
    )
    return row[0] ?? null
  })

const findByIdAndUserIdEffect: WorkspaceRepository["findByIdAndUserIdEffect"] = (
  id: string,
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(
          and(eq(workspaces.id, id), eq(workspaces.userId, userId)),
        )
        .limit(1),
    )
    return row[0] ?? null
  })

const findByUserIdAndLabelAndNamespaceEffect: WorkspaceRepository["findByUserIdAndLabelAndNamespaceEffect"] =
  (userId: string, keyLabel: string, namespace: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const row = yield* Effect.promise(() =>
        db
          .select()
          .from(workspaces)
          .where(
            and(
              eq(workspaces.userId, userId),
              eq(workspaces.knowhereKeyLabel, keyLabel),
              eq(workspaces.namespace, namespace),
            ),
          )
          .limit(1),
      )
      return row[0] ?? null
    })

const insertForUserLabelNamespaceEffect: WorkspaceRepository["insertForUserLabelNamespaceEffect"] =
  (userId: string, keyLabel: string | null, namespace: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      yield* Effect.promise(() =>
        db
          .insert(workspaces)
          .values({ userId, knowhereKeyLabel: keyLabel, namespace })
          .onConflictDoNothing({
            target: [
              workspaces.userId,
              workspaces.knowhereKeyLabel,
              workspaces.namespace,
            ],
          }),
      )
    })

const pingEffect: WorkspaceRepository["pingEffect"] = () =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() => db.execute(sql`select 1`))
  })

export const workspaceRepository: WorkspaceRepository = {
  findAllByUserIdEffect,
  findByIdEffect,
  findByIdAndUserIdEffect,
  findByUserIdAndLabelAndNamespaceEffect,
  insertForUserLabelNamespaceEffect,
  pingEffect,
}
