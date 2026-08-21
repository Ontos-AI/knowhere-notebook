import { notFound } from "next/navigation"

import { WorkspaceShell } from "@/components/workspace-shell"
import type { ChatMessageView, ChatThreadView } from "@/domains/chat/types"
import type { SourceView } from "@/domains/sources/types"

const sources: SourceView[] = [
  {
    id: "source_spacex",
    title: "spacex-s1.pdf",
    mimeType: "application/pdf",
    status: "ready",
    documentId: "doc_spacex",
    chunkCount: 1,
    documentPresentation: { kind: "page-assets", pageCount: 26 },
  },
]

const chatThreads: ChatThreadView[] = [
  {
    id: "thread_1",
    title: "Same page citations",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  },
]

const chatMessages: ChatMessageView[] = [
  {
    id: "assistant_1",
    role: "assistant",
    content: "Revenue grew [[cite:1]] and later expanded [[cite:2]].",
    citations: [
      {
        chunkType: "page",
        score: 0.91,
        pageCitationPageNumber: 26,
        highlightRegions: [{ x: 0.12, y: 0.18, w: 0.46, h: 0.08 }],
        source: {
          documentId: "doc_spacex",
          sourceFileName: "spacex-s1.pdf",
          sectionPath: "Page 26",
        },
      },
      {
        chunkType: "page",
        score: 0.89,
        pageCitationPageNumber: 26,
        highlightRegions: [
          { x: 0.62, y: 0.52, w: 0.24, h: 0.06 },
          { x: 0.15, y: 0.68, w: 0.32, h: 0.05 },
        ],
        source: {
          documentId: "doc_spacex",
          sourceFileName: "spacex-s1.pdf",
          sectionPath: "Page 26",
        },
      },
    ],
  },
]

export default function CitationSamePageTestPage() {
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
      sources={sources}
      chatThreads={chatThreads}
      activeChatThreadId="thread_1"
      chatMessages={chatMessages}
    />
  )
}
