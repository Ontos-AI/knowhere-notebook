import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import {
  workspaceMembers,
  workspaces,
  type Workspace,
} from "@/infrastructure/db/schema"

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
  readonly findByUserIdAndNamespaceEffect: (
    userId: string,
    namespace: string,
  ) => Effect.Effect<Workspace | null, never, DbClient>
  readonly insertForUserNamespaceEffect: (
    userId: string,
    namespace: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly pingEffect: () => Effect.Effect<void, never, DbClient>
}

/**
 * Workspaces the user can see: their own rows plus any they are a member
 * of (Phase 4 team sharing).
 */
const findAllByUserIdEffect: WorkspaceRepository["findAllByUserIdEffect"] = (
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const owned = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .orderBy(workspaces.createdAt),
    )
    const memberWorkspaceIds = yield* Effect.promise(() =>
      db
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        ),
    )
    if (memberWorkspaceIds.length === 0) return owned

    const memberRows = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(
          inArray(
            workspaces.id,
            memberWorkspaceIds.map((row) => row.workspaceId),
          ),
        ),
    )
    const seen = new Set(owned.map((workspace) => workspace.id))
    return [
      ...owned,
      ...memberRows.filter((workspace) => {
        if (seen.has(workspace.id)) return false
        seen.add(workspace.id)
        return true
      }),
    ]
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
    const owned = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, id), eq(workspaces.userId, userId)))
        .limit(1),
    )
    if (owned[0]) return owned[0]

    // Phase 4: members can access the workspace too.
    const membership = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, id),
            eq(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1),
    )
    if (membership.length === 0) return null

    const row = yield* Effect.promise(() =>
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .limit(1),
    )
    return row[0] ?? null
  })

const findByUserIdAndNamespaceEffect: WorkspaceRepository["findByUserIdAndNamespaceEffect"] =
  (userId: string, namespace: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const row = yield* Effect.promise(() =>
        db
          .select()
          .from(workspaces)
          .where(
            and(
              eq(workspaces.userId, userId),
              eq(workspaces.namespace, namespace),
            ),
          )
          .limit(1),
      )
      return row[0] ?? null
    })

const insertForUserNamespaceEffect: WorkspaceRepository["insertForUserNamespaceEffect"] =
  (userId: string, namespace: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      yield* Effect.promise(() =>
        db
          .insert(workspaces)
          .values({ userId, namespace })
          .onConflictDoNothing({
            target: [workspaces.userId, workspaces.namespace],
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
  findByUserIdAndNamespaceEffect,
  insertForUserNamespaceEffect,
  pingEffect,
}
