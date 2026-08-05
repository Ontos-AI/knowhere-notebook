import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import { workspaceMembers, type WorkspaceMember } from "@/infrastructure/db/schema"

type WorkspaceMembersRepository = {
  readonly isMemberEffect: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<boolean, never, DbClient>
  readonly listMembersEffect: (
    workspaceId: string,
  ) => Effect.Effect<WorkspaceMember[], never, DbClient>
  readonly listWorkspaceIdsForUserEffect: (
    userId: string,
  ) => Effect.Effect<string[], never, DbClient>
  readonly addMemberEffect: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<void, never, DbClient>
  readonly removeMemberEffect: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<void, never, DbClient>
}

const isMemberEffect: WorkspaceMembersRepository["isMemberEffect"] = (
  workspaceId: string,
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const rows = yield* Effect.promise(() =>
      db
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1),
    )
    return rows.length > 0
  })

const listMembersEffect: WorkspaceMembersRepository["listMembersEffect"] = (
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    return yield* Effect.promise(() =>
      db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            isNull(workspaceMembers.deletedAt),
          ),
        ),
    )
  })

const listWorkspaceIdsForUserEffect: WorkspaceMembersRepository["listWorkspaceIdsForUserEffect"] =
  (userId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const rows = yield* Effect.promise(() =>
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
      return rows.map((row) => row.workspaceId)
    })

const addMemberEffect: WorkspaceMembersRepository["addMemberEffect"] = (
  workspaceId: string,
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .insert(workspaceMembers)
        .values({ workspaceId, userId })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { deletedAt: null },
        }),
    )
  })

const removeMemberEffect: WorkspaceMembersRepository["removeMemberEffect"] = (
  workspaceId: string,
  userId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    yield* Effect.promise(() =>
      db
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        ),
    )
  })

export const workspaceMembersRepository: WorkspaceMembersRepository = {
  isMemberEffect,
  listMembersEffect,
  listWorkspaceIdsForUserEffect,
  addMemberEffect,
  removeMemberEffect,
}
