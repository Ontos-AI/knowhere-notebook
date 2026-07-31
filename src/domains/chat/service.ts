import { Effect, Either } from "effect"

import {
  answerQuestionWithRetrieval,
  type AnswerQuestionInput,
  type ChatHistoryMessage,
  type GenerateAnswer,
  type RetrievalClient,
} from "."
import { toChatMessageView } from "./view"
import type { ChatMessage, ChatThread, Source, Workspace } from "@/infrastructure/db/schema"
import { getCompatibleNamespaces } from "@/domains/sources/namespace"
import type {
  ChatArtifactView,
  ChatCitationView,
  ChatMessageView,
  RetrievalTraceView,
} from "@/domains/chat/types"

export type ChatRepository = {
  ensureDefaultChatThread(workspaceId: string): Promise<ChatThread>
  findChatThreadInWorkspace(
    workspaceId: string,
    threadId: string,
  ): Promise<ChatThread | null>
  listMessagesForThread(
    workspaceId: string,
    threadId: string,
  ): Promise<ChatMessage[] | null>
  appendMessageToThread(
    workspaceId: string,
    input: {
      threadId: string
      role: "user" | "assistant"
      content: string
      citations?: readonly ChatCitationView[] | null
      artifacts?: readonly ChatArtifactView[] | null
    },
  ): Promise<ChatMessage | null>
}

export type ChatTurnError =
  | { _tag: "NoReadySources"; message: string; status: 409 }
  | { _tag: "ThreadNotFound"; message: string; status: 404 }

const noReadySources = {
  _tag: "NoReadySources" as const,
  message: "Upload and process a document before asking questions.",
  status: 409 as const,
}

const threadNotFound = {
  _tag: "ThreadNotFound" as const,
  message: "Chat thread not found.",
  status: 404 as const,
}

export type ChatTurnValue = {
  threadId: string
  messages: [ChatMessageView, ChatMessageView]
  retrievalTrace?: RetrievalTraceView
}

type ChatTurnInput = {
  workspace: Workspace
  sources: readonly Source[]
  question: string
  threadId?: string
  excludedSourceIds: readonly string[]
  retrieval: RetrievalClient
  generateAnswer: GenerateAnswer
  loadSourceAssetUrls?: AnswerQuestionInput["loadSourceAssetUrls"]
  hardenMediaAssetUrls?: AnswerQuestionInput["hardenMediaAssetUrls"]
  repository: ChatRepository
}

/** Wrap a Promise as an Effect, treating rejections as defects. */
const tryPromiseOrDie = <A>(f: () => Promise<A>) =>
  Effect.tryPromise(f).pipe(Effect.catchAllCause(Effect.die))

export const handleChatTurnEffect = (input: ChatTurnInput) =>
  Effect.gen(function* () {
    const readySources = input.sources.filter(
      (source) => source.status === "ready" && source.knowhereDocumentId,
    )
    if (readySources.length === 0) {
      return yield* Effect.fail(noReadySources)
    }

    const thread = input.threadId
      ? yield* tryPromiseOrDie(() =>
          input.repository.findChatThreadInWorkspace(
            input.workspace.id,
            input.threadId!,
          ),
        )
      : yield* tryPromiseOrDie(() =>
          input.repository.ensureDefaultChatThread(input.workspace.id),
        )
    if (!thread) {
      return yield* Effect.fail(threadNotFound)
    }

    const previousMessages = yield* tryPromiseOrDie(() =>
      input.repository.listMessagesForThread(input.workspace.id, thread.id),
    )
    if (!previousMessages) {
      return yield* Effect.fail(threadNotFound)
    }
    const chatHistoryMessages = toChatHistoryMessages(previousMessages)

    const userMessage = yield* tryPromiseOrDie(() =>
      input.repository.appendMessageToThread(input.workspace.id, {
        threadId: thread.id,
        role: "user",
        content: input.question,
      }),
    )
    if (!userMessage) {
      return yield* Effect.fail(threadNotFound)
    }

    const answer = yield* answerQuestionWithRetrieval({
      question: input.question,
      namespace: input.workspace.namespace,
      namespaces: getCompatibleNamespaces(input.workspace),
      sources: readySources,
      excludedSourceIds: input.excludedSourceIds,
      retrieval: input.retrieval,
      generateAnswer: input.generateAnswer,
      loadSourceAssetUrls: input.loadSourceAssetUrls,
      hardenMediaAssetUrls: input.hardenMediaAssetUrls,
      messages: chatHistoryMessages,
    }).pipe(Effect.catchAllCause(Effect.die))

    const assistantMessage = yield* tryPromiseOrDie(() =>
      input.repository.appendMessageToThread(input.workspace.id, {
        threadId: thread.id,
        role: "assistant",
        content: answer.answer,
        citations: answer.citations,
        artifacts: answer.artifacts,
      }),
    )
    if (!assistantMessage) {
      return yield* Effect.fail(threadNotFound)
    }

    return {
      threadId: thread.id,
      messages: [
        toChatMessageView(userMessage),
        toChatMessageView(
          assistantMessage,
          answer.citations,
          answer.artifacts,
          answer.retrievalTrace,
        ),
      ] as [ChatMessageView, ChatMessageView],
      retrievalTrace: answer.retrievalTrace,
    }
  })

/**
 * Public API: returns Either for Next.js boundary callers that pattern-match
 * on the result. Internally uses Effect for structured error handling.
 */
export async function handleChatTurn(
  input: ChatTurnInput,
): Promise<Either.Either<ChatTurnValue, ChatTurnError>> {
  return Effect.runPromise(Effect.either(handleChatTurnEffect(input)))
}

function toChatHistoryMessages(
  messages: readonly ChatMessage[],
): ChatHistoryMessage[] {
  return messages.map((message): ChatHistoryMessage => {
    const view = toChatMessageView(message)
    return {
      role: view.role,
      content: view.content,
      citations: view.citations,
    }
  })
}
