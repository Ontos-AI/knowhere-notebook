import "server-only"

import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import { workspaces, type Workspace } from "@/infrastructure/db/schema"

type WorkspaceRepository = {
  readonly findByUserIdEffect: (
    userId: string,
  ) => Effect.Effect<Workspace | null, never, DbClient>
  readonly insertForUserEffect: (
    userId: string,
    namespace: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly pingEffect: () => Effect.Effect<void, never, DbClient>
}

const findByUserIdEffect: WorkspaceRepository["findByUserIdEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1),
    )

    return row[0] ?? null
  })

const insertForUserEffect: WorkspaceRepository["insertForUserEffect"] = (
  userId: string,
  namespace: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .insert(workspaces)
        .values({ userId, namespace })
        .onConflictDoNothing({ target: workspaces.userId }),
    )
  })

const pingEffect: WorkspaceRepository["pingEffect"] = () =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() => db.execute(sql`select 1`))
  })

export const workspaceRepository: WorkspaceRepository = {
  findByUserIdEffect,
  insertForUserEffect,
  pingEffect,
}
