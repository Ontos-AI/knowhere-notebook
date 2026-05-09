import { NextResponse, type NextRequest } from "next/server"
import { Schema } from "effect"

import { requireUser } from "@/lib/auth"
import { toChatMessageView, toChatThreadView } from "@/lib/chat-view"
import {
  ensureWorkspace,
  findChatThreadInWorkspace,
  listMessagesForThread,
  softDeleteChatThread,
} from "@/lib/workspace"

type RouteContext = {
  params: Promise<{
    threadId: string
  }>
}

const ArchiveRequest = Schema.Struct({
  archived: Schema.Literal(true),
})

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const { threadId } = await context.params
  const thread = await findChatThreadInWorkspace(workspace.id, threadId)

  if (!thread) {
    return NextResponse.json(
      { message: "Chat thread not found." },
      { status: 404 },
    )
  }

  const messages = await listMessagesForThread(workspace.id, threadId)
  if (!messages) {
    return NextResponse.json(
      { message: "Chat thread not found." },
      { status: 404 },
    )
  }

  return NextResponse.json({
    thread: toChatThreadView(thread),
    messages: messages.map((message) => toChatMessageView(message)),
  })
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const { threadId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { message: "Invalid request body." },
      { status: 400 },
    )
  }

  if (Schema.decodeUnknownEither(ArchiveRequest)(body)._tag === "Left") {
    return NextResponse.json(
      { message: "Request body must include `archived: true`." },
      { status: 400 },
    )
  }

  const archived = await softDeleteChatThread(workspace.id, threadId)
  if (!archived) {
    return NextResponse.json(
      { message: "Chat thread not found." },
      { status: 404 },
    )
  }

  return NextResponse.json({ id: threadId, archived: true })
}
