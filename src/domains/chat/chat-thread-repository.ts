import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { DbClient } from "@/infrastructure/db"
import {
  chatThreads,
  type ChatThread,
} from "@/infrastructure/db/schema"

type ChatThreadRepository = {
  readonly findThreadInWorkspaceEffect: (
    workspaceId: string,
    threadId: string,
  ) => Effect.Effect<ChatThread | null, never, DbClient>
  readonly listThreadsForWorkspaceEffect: (
    workspaceId: string,
  ) => Effect.Effect<ChatThread[], never, DbClient>
  readonly createThreadEffect: (
    workspaceId: string,
  ) => Effect.Effect<ChatThread, never, DbClient>
  readonly ensureDefaultThreadEffect: (
    workspaceId: string,
  ) => Effect.Effect<ChatThread, never, DbClient>
  readonly softDeleteThreadEffect: (
    workspaceId: string,
    threadId: string,
  ) => Effect.Effect<boolean, never, DbClient>
}

const chatThreadListLimit = 50

const findThreadInWorkspaceEffect: ChatThreadRepository["findThreadInWorkspaceEffect"] =
  (workspaceId: string, threadId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const row = yield* Effect.promise(() =>
        db
          .select()
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.id, threadId),
              eq(chatThreads.workspaceId, workspaceId),
              isNull(chatThreads.deletedAt),
            ),
          )
          .limit(1),
      )

      return row[0] ?? null
    })

const listThreadsForWorkspaceEffect: ChatThreadRepository["listThreadsForWorkspaceEffect"] =
  (workspaceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      return yield* Effect.promise(() =>
        db
          .select()
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.workspaceId, workspaceId),
              isNull(chatThreads.deletedAt),
            ),
          )
          .orderBy(desc(chatThreads.updatedAt))
          .limit(chatThreadListLimit),
      )
    })

const createThreadEffect: ChatThreadRepository["createThreadEffect"] = (
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const [thread] = yield* Effect.promise(() =>
      db.insert(chatThreads).values({ workspaceId }).returning(),
    )
    if (!thread) {
      return yield* Effect.die(
        new Error("createChatThread: insert did not return a row."),
      )
    }

    return thread
  })

const ensureDefaultThreadEffect: ChatThreadRepository["ensureDefaultThreadEffect"] =
  (workspaceId: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const existing = yield* Effect.promise(() =>
        db
          .select()
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.workspaceId, workspaceId),
              isNull(chatThreads.deletedAt),
            ),
          )
          .orderBy(desc(chatThreads.updatedAt))
          .limit(1),
      )
      if (existing[0]) return existing[0]

      const [thread] = yield* Effect.promise(() =>
        db.insert(chatThreads).values({ workspaceId }).returning(),
      )
      if (!thread) {
        return yield* Effect.die(
          new Error("ensureDefaultChatThread: insert did not return a row."),
        )
      }

      return thread
    })

const softDeleteThreadEffect: ChatThreadRepository["softDeleteThreadEffect"] = (
  workspaceId: string,
  threadId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const result = yield* Effect.promise(() =>
      db
        .update(chatThreads)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(chatThreads.id, threadId),
            eq(chatThreads.workspaceId, workspaceId),
            isNull(chatThreads.deletedAt),
          ),
        )
        .returning({ id: chatThreads.id }),
    )

    return result.length > 0
  })

export const chatThreadRepository: ChatThreadRepository = {
  findThreadInWorkspaceEffect,
  listThreadsForWorkspaceEffect,
  createThreadEffect,
  ensureDefaultThreadEffect,
  softDeleteThreadEffect,
}
