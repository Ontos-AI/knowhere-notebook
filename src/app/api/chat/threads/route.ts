import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { toChatThreadView } from "@/lib/chat-view"
import {
  createChatThread,
  ensureWorkspace,
  listChatThreadsForWorkspace,
} from "@/lib/workspace"

export async function GET(): Promise<NextResponse> {
  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const threads = await listChatThreadsForWorkspace(workspace.id)

  return NextResponse.json({
    threads: threads.map(toChatThreadView),
  })
}

export async function POST(): Promise<NextResponse> {
  const user = await requireUser()
  const workspace = await ensureWorkspace(user.id)
  const thread = await createChatThread(workspace.id)

  return NextResponse.json({
    thread: toChatThreadView(thread),
    messages: [],
  })
}
