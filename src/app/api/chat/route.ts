import { NextResponse } from "next/server";
import { Either } from "effect";

import {
  generateContextualRetrievalQuery,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "@/lib/chat";
import { handleChatTurn } from "@/lib/chat-service";
import { notebookRequestContext } from "@/lib/notebook-request-context";
import { reconcileSourcesForWorkspace } from "@/lib/source-reconcile";
import {
  appendMessageToThread,
  ensureDefaultChatThread,
  findChatThreadInWorkspace,
  listMessagesForThread,
} from "@/lib/workspace";

type ChatRepositoryMessages = Awaited<ReturnType<typeof listMessagesForThread>>
type ChatRepositoryMessage = NonNullable<ChatRepositoryMessages>[number]

export async function POST(request: Request): Promise<NextResponse> {
  const body = parseChatRequestBody(await readJson(request))
  if (!body.ok) {
    return NextResponse.json({ message: body.message }, { status: body.status })
  }

  const { workspace, client } =
    await notebookRequestContext.getAuthenticatedWithClient()
  const sources = await reconcileSourcesForWorkspace(workspace, client)

  try {
    const result = await handleChatTurn({
      workspace,
      sources,
      question: body.value.question,
      threadId: body.value.threadId,
      excludedSourceIds: body.value.excludedSourceIds,
      retrieval: client.retrieval,
      generateRetrievalQuery: generateContextualRetrievalQuery,
      generateAnswer: generateGroundedAnswer,
      repository: {
        ensureDefaultChatThread,
        findChatThreadInWorkspace,
        listMessagesForThread: listMutableMessagesForThread,
        appendMessageToThread,
      },
    })

    return Either.match(result, {
      onLeft: (error) =>
        NextResponse.json({ message: error.message }, { status: error.status }),
      onRight: (value) => NextResponse.json(value),
    })
  } catch {
    return NextResponse.json(
      { message: "Your session may have expired. Please refresh the page." },
      { status: 401 },
    )
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function listMutableMessagesForThread(
  workspaceId: string,
  threadId: string,
): Promise<ChatRepositoryMessage[] | null> {
  const messages = await listMessagesForThread(workspaceId, threadId)
  if (!messages) return null

  return [...messages]
}
