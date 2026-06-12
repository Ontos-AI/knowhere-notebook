import "server-only"

import { chatThreadService } from "./thread-service"
import type { ChatRepository } from "./service"
import type { ChatMessage, ChatThread } from "@/infrastructure/db/schema"
import type {
  ChatArtifactView,
  ChatCitationView,
  CitationView,
  RetrievalResultView,
} from "./types"

type AppendMessageInput = {
  readonly threadId: string
  readonly role: "user" | "assistant"
  readonly content: string
  readonly citations?:
    | readonly (ChatCitationView | CitationView | RetrievalResultView)[]
    | null
  readonly artifacts?: readonly ChatArtifactView[] | null
}

type ChatThreadPersistenceAdapter = {
  readonly appendMessage: (
    workspaceId: string,
    input: AppendMessageInput,
  ) => Promise<ChatMessage | null>
  readonly ensureDefault: (workspaceId: string) => Promise<ChatThread>
  readonly findInWorkspace: (
    workspaceId: string,
    threadId: string,
  ) => Promise<ChatThread | null>
  readonly listMessages: (
    workspaceId: string,
    threadId: string,
  ) => Promise<readonly ChatMessage[] | null>
}

type ChatTurnPersistence = {
  readonly createRepository: (
    adapter?: ChatThreadPersistenceAdapter,
  ) => ChatRepository
}

function createRepository(
  adapter: ChatThreadPersistenceAdapter = chatThreadService,
): ChatRepository {
  return {
    ensureDefaultChatThread: (workspaceId) =>
      adapter.ensureDefault(workspaceId),

    findChatThreadInWorkspace: (workspaceId, threadId) =>
      adapter.findInWorkspace(workspaceId, threadId),

    listMessagesForThread: async (workspaceId, threadId) => {
      const messages = await adapter.listMessages(workspaceId, threadId)
      return messages ? [...messages] : null
    },

    appendMessageToThread: (workspaceId, input) =>
      adapter.appendMessage(workspaceId, input),
  }
}

export const chatTurnPersistence: ChatTurnPersistence = {
  createRepository,
}
