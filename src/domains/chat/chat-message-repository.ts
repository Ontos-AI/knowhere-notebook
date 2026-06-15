import "server-only"

import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import { chatCitationPersistence } from "./chat-citation-persistence"
import { chatThreadRepository } from "./chat-thread-repository"
import { deriveChatThreadTitle } from "./title"
import { DbClient } from "@/infrastructure/db"
import { chatMessages, chatThreads, type ChatMessage } from "@/infrastructure/db/schema"
import type {
  ChatArtifactView,
  ChatCitationView,
  CitationView,
  RetrievalResultView,
} from "@/domains/chat/types"

type AppendChatMessageInput = {
  readonly threadId: string
  readonly role: "user" | "assistant"
  readonly content: string
  readonly citations?:
    | readonly (ChatCitationView | CitationView | RetrievalResultView)[]
    | null
  readonly artifacts?: readonly ChatArtifactView[] | null
}

type ChatMessageRepository = {
  readonly listMessagesForThreadEffect: (
    workspaceId: string,
    threadId: string,
  ) => Effect.Effect<ChatMessage[] | null, never, DbClient>
  readonly appendMessageToThreadEffect: (
    workspaceId: string,
    input: AppendChatMessageInput,
  ) => Effect.Effect<ChatMessage | null, never, DbClient>
  readonly updateMessageCitationsEffect: (
    messageId: string,
    citations: CitationView[] | null,
  ) => Effect.Effect<ChatMessage | null, never, DbClient>
}

const listMessagesForThreadEffect: ChatMessageRepository["listMessagesForThreadEffect"] =
  (workspaceId: string, threadId: string) =>
    Effect.gen(function* () {
      const thread = yield* chatThreadRepository.findThreadInWorkspaceEffect(
        workspaceId,
        threadId,
      )
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

const appendMessageToThreadEffect: ChatMessageRepository["appendMessageToThreadEffect"] =
  (workspaceId: string, input: AppendChatMessageInput) =>
    Effect.gen(function* () {
      const thread = yield* chatThreadRepository.findThreadInWorkspaceEffect(
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
              citations: chatCitationPersistence.normalizeCitations(
                input.citations,
              ),
              artifacts: chatCitationPersistence.normalizeArtifacts(
                input.artifacts,
              ),
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

const updateMessageCitationsEffect: ChatMessageRepository["updateMessageCitationsEffect"] =
  (messageId: string, citations: CitationView[] | null) =>
    Effect.gen(function* () {
      const db = yield* DbClient
      const [updated] = yield* Effect.promise(() =>
        db
          .update(chatMessages)
          .set({ citations })
          .where(eq(chatMessages.id, messageId))
          .returning(),
      )
      return updated ?? null
    })

export const chatMessageRepository: ChatMessageRepository = {
  listMessagesForThreadEffect,
  appendMessageToThreadEffect,
  updateMessageCitationsEffect,
}
