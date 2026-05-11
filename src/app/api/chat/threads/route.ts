import { NextResponse } from "next/server"

import { toChatThreadView } from "@/lib/chat-view"
import { notebookRequestContext } from "@/lib/notebook-request-context"
import {
  createChatThread,
  listChatThreadsForWorkspace,
} from "@/lib/workspace"

export async function GET(): Promise<NextResponse> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const threads = await listChatThreadsForWorkspace(workspace.id)

  return NextResponse.json({
    threads: threads.map(toChatThreadView),
  })
}

export async function POST(): Promise<NextResponse> {
  const { workspace } = await notebookRequestContext.getAuthenticated()
  const thread = await createChatThread(workspace.id)

  return NextResponse.json({
    thread: toChatThreadView(thread),
    messages: [],
  })
}
