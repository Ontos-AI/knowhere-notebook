import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { chatCitationPersistence } from "./chat-citation-persistence"
import { DbClient } from "@/infrastructure/db"
import {
  chatMessages,
  chatThreads,
  type ChatMessage,
  type ChatThread,
} from "@/infrastructure/db/schema"
import type { ChatCitationView } from "./types"

type SeedDemoChatMessage = {
  readonly role: "user" | "assistant"
  readonly content: string
  readonly citations?: readonly ChatCitationView[] | null
}

type SeedDemoChatThreadInput = {
  readonly demoKey: string
  readonly title: string
  readonly messages: readonly SeedDemoChatMessage[]
}

type SeedDemoChatThreadResult = {
  readonly thread: ChatThread
  readonly messages: ChatMessage[]
}

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
  readonly ensureDemoThreadEffect: (
    workspaceId: string,
    input: SeedDemoChatThreadInput,
  ) => Effect.Effect<SeedDemoChatThreadResult | null, never, DbClient>
  readonly softDeleteThreadEffect: (
    workspaceId: string,
    threadId: string,
  ) => Effect.Effect<boolean, never, DbClient>
  readonly findThreadByDemoKeyEffect: (
    workspaceId: string,
    demoKey: string,
  ) => Effect.Effect<ChatThread | null, never, DbClient>
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

const ensureDemoThreadEffect: ChatThreadRepository["ensureDemoThreadEffect"] =
  (workspaceId: string, input: SeedDemoChatThreadInput) =>
    Effect.gen(function* () {
      if (input.messages.length === 0) return null

      const db = yield* DbClient
      return yield* Effect.promise(() =>
        db.transaction(async (tx) => {
          const insertDemoMessages = async (
            threadId: string,
          ): Promise<ChatMessage[]> => {
            const createdAtMs = Date.now()
            return await tx
              .insert(chatMessages)
              .values(
                input.messages.map((message, index) => ({
                  threadId,
                  role: message.role,
                  content: message.content,
                  citations: chatCitationPersistence.normalizeCitations(
                    message.citations,
                  ),
                  createdAt: new Date(createdAtMs + index),
                })),
              )
              .returning()
          }

          const existing = (
            await tx
              .select()
              .from(chatThreads)
              .where(
                and(
                  eq(chatThreads.workspaceId, workspaceId),
                  eq(chatThreads.demoKey, input.demoKey),
                ),
              )
              .limit(1)
          )[0]

          if (existing) {
            if (existing.deletedAt !== null) return null

            const existingMessages = await tx
              .select()
              .from(chatMessages)
              .where(eq(chatMessages.threadId, existing.id))
              .orderBy(chatMessages.createdAt)
            if (existingMessages.length > 0) {
              return {
                thread: existing,
                messages: existingMessages,
              }
            }

            const messages = await insertDemoMessages(existing.id)
            return {
              thread: existing,
              messages,
            }
          }

          const [thread] = await tx
            .insert(chatThreads)
            .values({
              workspaceId,
              demoKey: input.demoKey,
              title: input.title,
            })
            .returning()

          if (!thread) {
            throw new Error("ensureDemoChatThread: insert did not return a row.")
          }

          const messages = await insertDemoMessages(thread.id)
          return { thread, messages }
        }),
      )
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

const findThreadByDemoKeyEffect: ChatThreadRepository["findThreadByDemoKeyEffect"] =
  (workspaceId: string, demoKey: string) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const row = yield* Effect.promise(() =>
        db
          .select()
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.workspaceId, workspaceId),
              eq(chatThreads.demoKey, demoKey),
              isNull(chatThreads.deletedAt),
            ),
          )
          .limit(1),
      )
      return row[0] ?? null
    })

export const chatThreadRepository: ChatThreadRepository = {
  findThreadInWorkspaceEffect,
  listThreadsForWorkspaceEffect,
  createThreadEffect,
  ensureDefaultThreadEffect,
  ensureDemoThreadEffect,
  softDeleteThreadEffect,
  findThreadByDemoKeyEffect,
}
