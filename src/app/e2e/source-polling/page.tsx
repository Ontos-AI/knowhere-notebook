import { notFound } from "next/navigation"

import { WorkspaceShell } from "@/components/workspace-shell"
import type { SourceView } from "@/domains/sources/types"

const pendingSource: SourceView = {
  id: "source_pending",
  title: "Long Parse.pdf",
  mimeType: "application/pdf",
  status: "parsing",
}

export default function SourcePollingTestPage() {
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
      sources={[pendingSource]}
      chatThreads={[]}
      chatMessages={[]}
      activeChatThreadId={null}
    />
  )
}
