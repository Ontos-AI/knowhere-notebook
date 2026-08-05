import { notFound } from "next/navigation"

import { WorkspaceShell } from "@/components/workspace-shell"
import type { ChatMessageView, ChatThreadView } from "@/domains/chat/types"
import type { SourceView } from "@/domains/sources/types"

const duplicateTitleSources: SourceView[] = [
  {
    id: "source_first",
    title: "report.pdf",
    mimeType: "application/pdf",
    status: "ready",
    documentId: "doc_first",
    chunkCount: 1,
  },
  {
    id: "source_second",
    title: "report.pdf",
    mimeType: "application/pdf",
    status: "ready",
    documentId: "doc_second",
    chunkCount: 1,
  },
]

const chatThreads: ChatThreadView[] = [
  {
    id: "thread_1",
    title: "Duplicate source labels",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
]

const chatMessages: ChatMessageView[] = [
  {
    id: "assistant_1",
    role: "assistant",
    content: "Both reports are relevant to the answer.",
    citations: [
      {
        chunkType: "text",
        score: 0.91,
        source: {
          documentId: "doc_first",
          sourceFileName: "report.pdf",
          sectionPath: "Revenue / FY2026 outlook",
        },
      },
      {
        chunkType: "text",
        score: 0.89,
        source: {
          documentId: "doc_second",
          sourceFileName: "report.pdf",
          sectionPath: "Operations / AI infrastructure",
        },
      },
    ],
  },
]

export default function CitationDedupeTestPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <WorkspaceShell
      user={{
        id: "user_playwright",
        name: "Playwright",
        email: "playwright@example.com",
      }}
      workspace={{
        id: "workspace_playwright",
        namespace: "notebook-playwright",
      }}
      sources={duplicateTitleSources}
      chatThreads={chatThreads}
      activeChatThreadId="thread_1"
      chatMessages={chatMessages}
    />
  )
}
