import { headers } from "next/headers"
import { NextResponse } from "next/server";
import { Either } from "effect";

import { ensureApiKeyForWorkspace } from "@/lib/api-key-service";
import { requireUser } from "@/lib/auth";
import {
  generateContextualRetrievalQuery,
  generateGroundedAnswer,
  parseChatRequestBody,
} from "@/lib/chat";
import { handleChatTurn } from "@/lib/chat-service";
import { makeKnowhereClient } from "@/lib/knowhere";
import { ensureWorkspace, listSourcesForWorkspace } from "@/lib/workspace";
import {
  appendMessageToThread,
  ensureDefaultChatThread,
  findChatThreadInWorkspace,
  listMessagesForThread,
} from "@/lib/workspace";

export async function POST(request: Request): Promise<NextResponse> {
  const body = parseChatRequestBody(await readJson(request))
  if (!body.ok) {
    return NextResponse.json({ message: body.message }, { status: body.status })
  }

  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const sources = await listSourcesForWorkspace(workspace.id)
  const cookieHeader = (await headers()).get("cookie") ?? ""
  const apiKey = await ensureApiKeyForWorkspace(workspace.id, cookieHeader)
  const client = makeKnowhereClient(apiKey)

  try {
    const result = await handleChatTurn({
      workspace,
      sources,
      question: body.value.question,
      threadId: body.value.threadId,
      excludedSourceIds: body.value.excludedSourceIds,
      retrieval: client.retrieval,
      documentChunks: client,
      generateRetrievalQuery: generateContextualRetrievalQuery,
      generateAnswer: generateGroundedAnswer,
      repository: {
        ensureDefaultChatThread,
        findChatThreadInWorkspace,
        listMessagesForThread,
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
