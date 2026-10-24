import { notFound } from "next/navigation"

import { WorkspaceShell } from "@/components/workspace-shell"
import type { SourceView } from "@/domains/sources/types"

const sharedSource: SourceView = {
  id: "demo-report",
  kind: "demo",
  demoSourceId: "demo-report",
  documentId: "ddoc-report",
  namespace: "__knowhere_demo__",
  jobResultId: "revision-current",
  title: "Shared report.pdf",
  mimeType: "application/pdf",
  status: "ready",
  chunkCount: 1,
  originalFile: {
    url: "/api/demo-sources/demo-report/original?job_result_id=revision-current",
    mimeType: "application/pdf",
    canDownload: true,
  },
}

export default function SharedDemoChatTestPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <WorkspaceShell
      user={{ id: "user_playwright", name: "Playwright", email: "playwright@example.com" }}
      workspace={{ id: "workspace_playwright", namespace: "default" }}
      sources={[sharedSource]}
      chatThreads={[]}
      chatMessages={[]}
      activeChatThreadId={null}
    />
  )
}
