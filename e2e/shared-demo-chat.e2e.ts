import { expect, test } from "@playwright/test"

test("sends shared demo chat without preparation and reads the cited revision", async ({ context, page }) => {
  let materializationRequests: number = 0
  const chunkRevisions: string[] = []
  await context.addCookies([{ name: "better-auth.session_token", value: "playwright", url: "http://localhost:3000" }])
  await page.route("**/api/demo-sources/materialize", async (route) => {
    materializationRequests += 1
    await route.fulfill({ status: 410, json: { message: "Personal demo materialization has been retired." } })
  })
  await page.route("**/api/sources/demo-report/chunks**", async (route) => {
    const revision: string = new URL(route.request().url()).searchParams.get("jobResultId") ?? ""
    chunkRevisions.push(revision)
    await route.fulfill({ json: {
      chunks: [{ chunkId: "row-report", parserChunkId: "report-chunk", documentId: "ddoc-report", jobResultId: revision, type: "text", content: revision === "revision-cited" ? "Historical report evidence." : "Current report evidence.", sourceTitle: "Shared report.pdf" }],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    } })
  })
  await page.route("**/api/chat", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ message: "Summarize the shared report", excludedSourceIds: [] })
    await route.fulfill({ json: {
      threadId: "thread-shared",
      messages: [
        { id: "question", role: "user", content: "Summarize the shared report" },
        { id: "answer", role: "assistant", content: "The shared report provides evidence. [[cite:1]]", retrievalWarnings: [{ scope: "workspace", code: "RETRIEVAL_UNAVAILABLE", message: "Your documents could not be searched. This answer uses demo sources only." }], citations: [{ chunkId: "report-chunk", content: "Historical report evidence.", chunkType: "text", score: 0.9, source: { documentId: "ddoc-report", namespace: "__knowhere_demo__", jobResultId: "revision-cited", sourceFileName: "Shared report.pdf", sectionPath: "Root" } }] },
      ],
      citationSources: [{ id: "demo-report", kind: "demo", demoSourceId: "demo-report", documentId: "ddoc-report", namespace: "__knowhere_demo__", jobResultId: "revision-cited", title: "Shared report.pdf", mimeType: "application/pdf", status: "ready" }],
    } })
  })
  await page.goto("/e2e/shared-demo-chat")
  const chatPanel = page.getByTestId("desktop-chat-panel")
  await chatPanel.getByRole("textbox", { name: "Chat message" }).fill("Summarize the shared report")
  await chatPanel.getByRole("button", { name: "Send message" }).click()
  await expect(chatPanel.getByText("The shared report provides evidence.", { exact: false })).toBeVisible()
  await expect(chatPanel.getByRole("status")).toContainText("Your documents could not be searched")
  expect(materializationRequests).toBe(0)
  await chatPanel.getByTestId("citation-chip").click()
  await expect(page.getByText("Historical report evidence.", { exact: true })).toBeVisible()
  expect(chunkRevisions).toContain("revision-cited")
})
