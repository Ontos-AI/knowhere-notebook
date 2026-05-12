import { expect, test } from "@playwright/test"

test("refreshes pending source state immediately after browser mount", async ({
  context,
  page,
}) => {
  let sourceRequestCount = 0

  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "playwright",
      url: "http://localhost:3000",
    },
  ])
  await page.route("**/api/sources", async (route) => {
    sourceRequestCount += 1
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100)
    })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sources: [
          {
            id: "source_pending",
            title: "Long Parse.pdf",
            mimeType: "application/pdf",
            status: "ready",
            documentId: "document_ready",
            chunkCount: 4,
          },
        ],
      }),
    })
  })

  await page.goto("/e2e/source-polling")

  const desktopSourcesPanel = page.getByTestId("desktop-sources-panel")
  await expect(desktopSourcesPanel.getByText("Preparing")).toBeVisible()
  await expect(
    desktopSourcesPanel.getByText("Processed · 4 chunks"),
  ).toBeVisible()
  expect(sourceRequestCount).toBeGreaterThanOrEqual(1)
})
