import "server-only"

import { chatMessageRepository } from "./chat-message-repository"
import { chatThreadRepository } from "./chat-thread-repository"

type ChatRepository = {
  readonly findThreadInWorkspaceEffect: typeof chatThreadRepository.findThreadInWorkspaceEffect
  readonly listThreadsForWorkspaceEffect: typeof chatThreadRepository.listThreadsForWorkspaceEffect
  readonly createThreadEffect: typeof chatThreadRepository.createThreadEffect
  readonly ensureDefaultThreadEffect: typeof chatThreadRepository.ensureDefaultThreadEffect
  readonly listMessagesForThreadEffect: typeof chatMessageRepository.listMessagesForThreadEffect
  readonly softDeleteThreadEffect: typeof chatThreadRepository.softDeleteThreadEffect
  readonly appendMessageToThreadEffect: typeof chatMessageRepository.appendMessageToThreadEffect
}

export const chatRepository: ChatRepository = {
  findThreadInWorkspaceEffect: chatThreadRepository.findThreadInWorkspaceEffect,
  listThreadsForWorkspaceEffect: chatThreadRepository.listThreadsForWorkspaceEffect,
  createThreadEffect: chatThreadRepository.createThreadEffect,
  ensureDefaultThreadEffect: chatThreadRepository.ensureDefaultThreadEffect,
  listMessagesForThreadEffect: chatMessageRepository.listMessagesForThreadEffect,
  softDeleteThreadEffect: chatThreadRepository.softDeleteThreadEffect,
  appendMessageToThreadEffect: chatMessageRepository.appendMessageToThreadEffect,
}
