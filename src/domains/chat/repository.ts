import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { deriveChatThreadTitle } from "./title"
import { DEMO_CHAT_MESSAGES } from "./demo"
import { DbClient } from "@/infrastructure/db"
import {
  chatMessages,
  chatThreads,
  type ChatMessage,
  type ChatThread,
} from "@/infrastructure/db/schema"
import type { ChatCitationView, CitationView, RetrievalResultView } from "@/lib/types"

type AppendChatMessageInput = {
  threadId: string
  role: "user" | "assistant"
  content: string
  citations?:
    | readonly (ChatCitationView | CitationView | RetrievalResultView)[]
    | null
}

type ChatRepository = {
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
  readonly listMessagesForThreadEffect: (
    workspaceId: string,
    threadId: string,
  ) => Effect.Effect<ChatMessage[] | null, never, DbClient>
  readonly softDeleteThreadEffect: (
    workspaceId: string,
    threadId: string,
  ) => Effect.Effect<boolean, never, DbClient>
  readonly appendMessageToThreadEffect: (
    workspaceId: string,
    input: AppendChatMessageInput,
  ) => Effect.Effect<ChatMessage | null, never, DbClient>
  readonly ensureDemoThreadEffect: (
    workspaceId: string,
    demoKey: string,
    title: string,
    documentId: string,
  ) => Effect.Effect<void, never, DbClient>
}

const chatThreadListLimit = 50
const demoChatCreatedAtMs = Date.parse("2026-01-01T00:00:00.000Z")

const findThreadInWorkspaceEffect: ChatRepository["findThreadInWorkspaceEffect"] =
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

const listThreadsForWorkspaceEffect: ChatRepository["listThreadsForWorkspaceEffect"] =
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

const createThreadEffect: ChatRepository["createThreadEffect"] = (
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

const ensureDefaultThreadEffect: ChatRepository["ensureDefaultThreadEffect"] =
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

const listMessagesForThreadEffect: ChatRepository["listMessagesForThreadEffect"] =
  (workspaceId: string, threadId: string) =>
    Effect.gen(function* () {
      const thread = yield* findThreadInWorkspaceEffect(workspaceId, threadId)
      if (!thread) return null

      const db = yield* DbClient
      return yield* Effect.promise(() =>
        db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.threadId, threadId))
          .orderBy(chatMessages.createdAt),
      )
    })

const softDeleteThreadEffect: ChatRepository["softDeleteThreadEffect"] = (
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

const appendMessageToThreadEffect: ChatRepository["appendMessageToThreadEffect"] =
  (workspaceId: string, input: AppendChatMessageInput) =>
    Effect.gen(function* () {
      const thread = yield* findThreadInWorkspaceEffect(
        workspaceId,
        input.threadId,
      )
      if (!thread) return null

      const db = yield* DbClient
      return yield* Effect.promise(() =>
        db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(chatMessages)
            .values({
              threadId: input.threadId,
              role: input.role,
              content: input.content,
              citations: normalizeCitations(input.citations),
            })
            .returning()

          await tx
            .update(chatThreads)
            .set({
              updatedAt: sql`now()`,
              ...(input.role === "user" && !thread.title
                ? { title: deriveChatThreadTitle(input.content) }
                : {}),
            })
            .where(eq(chatThreads.id, input.threadId))

          return inserted ?? null
        }),
      )
    })

const ensureDemoThreadEffect: ChatRepository["ensureDemoThreadEffect"] = (
  workspaceId: string,
  demoKey: string,
  title: string,
  documentId: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbClient
    const existingThread = yield* Effect.promise(() =>
      db
        .select({ id: chatThreads.id })
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.workspaceId, workspaceId),
            eq(chatThreads.demoKey, demoKey),
          ),
        )
        .limit(1),
    )

    if (existingThread[0]) return

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [thread] = await tx
          .insert(chatThreads)
          .values({
            workspaceId,
            title,
            demoKey,
            createdAt: new Date(demoChatCreatedAtMs),
            updatedAt: new Date(
              demoChatCreatedAtMs + DEMO_CHAT_MESSAGES.length * 1000,
            ),
          })
          .onConflictDoNothing({
            target: [chatThreads.workspaceId, chatThreads.demoKey],
          })
          .returning()

        if (!thread) return

        await tx.insert(chatMessages).values(
          DEMO_CHAT_MESSAGES.map((message, index) => ({
            threadId: thread.id,
            role: message.role,
            content: message.content,
            citations: normalizeCitations(
              replaceDemoCitationDocumentId(message.citations, documentId),
            ),
            createdAt: new Date(demoChatCreatedAtMs + index * 1000),
          })),
        )
      }),
    )
  })

function normalizeCitations(
  citations:
    | readonly (ChatCitationView | CitationView | RetrievalResultView)[]
    | null
    | undefined,
): CitationView[] | null {
  if (!citations || citations.length === 0) return null
  return citations.map(toCitationView)
}

function replaceDemoCitationDocumentId(
  citations: readonly ChatCitationView[] | undefined,
  documentId: string,
): ChatCitationView[] | undefined {
  if (!citations) return undefined

  return citations.map((citation) => ({
    ...citation,
    source: {
      ...citation.source,
      documentId,
    },
  }))
}

function toCitationView(
  citation: ChatCitationView | CitationView | RetrievalResultView,
): CitationView {
  return {
    chunkType: citation.chunkType,
    score: citation.score,
    assetUrl: citation.assetUrl,
    description: "description" in citation ? citation.description : undefined,
    source: {
      documentId: citation.source.documentId,
      sourceFileName: citation.source.sourceFileName,
      sectionPath: citation.source.sectionPath,
    },
  }
}

export const chatRepository: ChatRepository = {
  findThreadInWorkspaceEffect,
  listThreadsForWorkspaceEffect,
  createThreadEffect,
  ensureDefaultThreadEffect,
  listMessagesForThreadEffect,
  softDeleteThreadEffect,
  appendMessageToThreadEffect,
  ensureDemoThreadEffect,
}
