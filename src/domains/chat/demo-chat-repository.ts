import "server-only"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

import { chatCitationPersistence } from "./chat-citation-persistence"
import { DEMO_CHAT_MESSAGES } from "./demo"
import { DbClient } from "@/infrastructure/db"
import { chatMessages, chatThreads } from "@/infrastructure/db/schema"

type DemoChatRepository = {
  readonly ensureDemoThreadEffect: (
    workspaceId: string,
    demoKey: string,
    title: string,
    documentId: string,
  ) => Effect.Effect<void, never, DbClient>
}

const demoChatCreatedAtMs = Date.parse("2026-01-01T00:00:00.000Z")

const ensureDemoThreadEffect: DemoChatRepository["ensureDemoThreadEffect"] = (
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
            citations: chatCitationPersistence.normalizeCitations(
              chatCitationPersistence.replaceDemoCitationDocumentId(
                message.citations,
                documentId,
              ),
            ),
            createdAt: new Date(demoChatCreatedAtMs + index * 1000),
          })),
        )
      }),
    )
  })

export const demoChatRepository: DemoChatRepository = {
  ensureDemoThreadEffect,
}
