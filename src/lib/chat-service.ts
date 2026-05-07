import type { RetrievalResult } from "@ontos-ai/knowhere-sdk";

import {
  answerQuestionWithRetrieval,
  type GenerateAnswer,
  type RetrievalClient,
} from "./chat";
import type { ChatMessage, ChatThread, Source, Workspace } from "./schema";
import type { ChatCitationView, ChatMessageView } from "./types";

export type ChatRepository = {
  ensureDefaultChatThread(workspaceId: string): Promise<ChatThread>;
  findChatThreadInWorkspace(
    workspaceId: string,
    threadId: string,
  ): Promise<ChatThread | null>;
  appendMessageToThread(
    workspaceId: string,
    input: {
      threadId: string;
      role: "user" | "assistant";
      content: string;
      citations?: readonly RetrievalResult[] | null;
    },
  ): Promise<ChatMessage | null>;
};

export type HandleChatTurnResult =
  | {
      ok: true;
      value: {
        threadId: string;
      messages: [ChatMessageView, ChatMessageView];
      };
    }
  | {
      ok: false;
      status: 404 | 409;
      message: string;
    };

export async function handleChatTurn(input: {
  workspace: Workspace;
  sources: readonly Source[];
  question: string;
  threadId?: string;
  excludedSourceIds: readonly string[];
  retrieval: RetrievalClient;
  generateAnswer: GenerateAnswer;
  repository: ChatRepository;
}): Promise<HandleChatTurnResult> {
  const readySources = input.sources.filter(
    (source) => source.status === "ready" && source.knowhereDocumentId,
  );
  if (readySources.length === 0) {
    return {
      ok: false,
      status: 409,
      message: "Upload and process a document before asking questions.",
    };
  }

  const thread = input.threadId
    ? await input.repository.findChatThreadInWorkspace(
        input.workspace.id,
        input.threadId,
      )
    : await input.repository.ensureDefaultChatThread(input.workspace.id);
  if (!thread) {
    return { ok: false, status: 404, message: "Chat thread not found." };
  }

  const userMessage = await input.repository.appendMessageToThread(
    input.workspace.id,
    {
      threadId: thread.id,
      role: "user",
      content: input.question,
    },
  );
  if (!userMessage) {
    return { ok: false, status: 404, message: "Chat thread not found." };
  }

  const answer = await answerQuestionWithRetrieval({
    question: input.question,
    namespace: input.workspace.namespace,
    sources: readySources,
    excludedSourceIds: input.excludedSourceIds,
    retrieval: input.retrieval,
    generateAnswer: input.generateAnswer,
  });
  const assistantMessage = await input.repository.appendMessageToThread(
    input.workspace.id,
    {
      threadId: thread.id,
      role: "assistant",
      content: answer.answer,
      citations: answer.citations,
    },
  );
  if (!assistantMessage) {
    return { ok: false, status: 404, message: "Chat thread not found." };
  }

  return {
    ok: true,
    value: {
      threadId: thread.id,
      messages: [
        toChatMessageView(userMessage),
        toChatMessageView(assistantMessage, answer.citations),
      ],
    },
  };
}

function toChatMessageView(
  message: ChatMessage,
  citations: RetrievalResult[] = [],
): ChatMessageView {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    citations: citations.length > 0 ? citations.map(toRetrievalResultView) : undefined,
  };
}

function toRetrievalResultView(result: RetrievalResult): ChatCitationView {
  return {
    content: result.content,
    chunkType: result.chunkType,
    score: result.score,
    assetUrl: result.assetUrl,
    source: {
      documentId: result.source.documentId,
      sourceFileName: result.source.sourceFileName,
      sectionPath: result.source.sectionPath,
    },
  };
}
