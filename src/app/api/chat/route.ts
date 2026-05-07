import { NextResponse } from "next/server";
import { Effect, Either } from "effect";

import { requireUser } from "@/lib/auth";
import { generateGroundedAnswer, parseChatRequestBody } from "@/lib/chat";
import { handleChatTurn } from "@/lib/chat-service";
import { KnowhereClient, knowhereClientLayer } from "@/lib/knowhere";
import { ensureWorkspace, listSourcesForWorkspace } from "@/lib/workspace";
import {
  appendMessageToThread,
  ensureDefaultChatThread,
  findChatThreadInWorkspace,
} from "@/lib/workspace";

export async function POST(request: Request): Promise<NextResponse> {
  const body = parseChatRequestBody(await readJson(request))
  if (!body.ok) {
    return NextResponse.json({ message: body.message }, { status: body.status })
  }

  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const sources = await listSourcesForWorkspace(workspace.id)
  const client = await Effect.runPromise(
    KnowhereClient.pipe(Effect.provide(knowhereClientLayer)),
  )
  const result = await handleChatTurn({
    workspace,
    sources,
    question: body.value.question,
    threadId: body.value.threadId,
    excludedSourceIds: body.value.excludedSourceIds,
    retrieval: client.retrieval,
    generateAnswer: generateGroundedAnswer,
    repository: {
      ensureDefaultChatThread,
      findChatThreadInWorkspace,
      appendMessageToThread,
    },
  })

  return Either.match(result, {
    onLeft: (error) =>
      NextResponse.json({ message: error.message }, { status: error.status }),
    onRight: (value) => NextResponse.json(value),
  })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
