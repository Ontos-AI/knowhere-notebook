import "server-only"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { chatRepository } from "./repository"
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

type ChatThreadService = {
  readonly findInWorkspace: (
    workspaceId: string,
    threadId: string,
  ) => Promise<ChatThread | null>
  readonly listForWorkspace: (workspaceId: string) => Promise<ChatThread[]>
  readonly create: (workspaceId: string) => Promise<ChatThread>
  readonly ensureDefault: (workspaceId: string) => Promise<ChatThread>
  readonly listMessages: (
    workspaceId: string,
    threadId: string,
  ) => Promise<ChatMessage[] | null>
  readonly softDelete: (
    workspaceId: string,
    threadId: string,
  ) => Promise<boolean>
  readonly appendMessage: (
    workspaceId: string,
    input: AppendMessageInput,
  ) => Promise<ChatMessage | null>
}

const findInWorkspace: ChatThreadService["findInWorkspace"] = (
  workspaceId: string,
  threadId: string,
) =>
  databaseRuntime.runPromise(
    chatRepository.findThreadInWorkspaceEffect(workspaceId, threadId),
  )

const listForWorkspace: ChatThreadService["listForWorkspace"] = (
  workspaceId: string,
) =>
  databaseRuntime.runPromise(
    chatRepository.listThreadsForWorkspaceEffect(workspaceId),
  )

const create: ChatThreadService["create"] = (workspaceId: string) =>
  databaseRuntime.runPromise(chatRepository.createThreadEffect(workspaceId))

const ensureDefault: ChatThreadService["ensureDefault"] = (
  workspaceId: string,
) =>
  databaseRuntime.runPromise(
    chatRepository.ensureDefaultThreadEffect(workspaceId),
  )

const listMessages: ChatThreadService["listMessages"] = (
  workspaceId: string,
  threadId: string,
) =>
  databaseRuntime.runPromise(
    chatRepository.listMessagesForThreadEffect(workspaceId, threadId),
  )

const softDelete: ChatThreadService["softDelete"] = (
  workspaceId: string,
  threadId: string,
) =>
  databaseRuntime.runPromise(
    chatRepository.softDeleteThreadEffect(workspaceId, threadId),
  )

const appendMessage: ChatThreadService["appendMessage"] = (
  workspaceId: string,
  input: AppendMessageInput,
) =>
  databaseRuntime.runPromise(
    chatRepository.appendMessageToThreadEffect(workspaceId, input),
  )

export const chatThreadService: ChatThreadService = {
  findInWorkspace,
  listForWorkspace,
  create,
  ensureDefault,
  listMessages,
  softDelete,
  appendMessage,
}
