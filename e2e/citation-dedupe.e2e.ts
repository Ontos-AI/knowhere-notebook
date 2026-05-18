import { expect, test } from "@playwright/test"

test.setTimeout(60_000)

test("keeps duplicate source labels clickable for separate documents", async ({
  context,
  page,
}) => {
  let firstSourceChunkRequests = 0
  let secondSourceChunkRequests = 0

  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "playwright",
      url: "http://localhost:3000",
    },
  ])

  await page.route("**/api/sources/source_first/chunks**", async (route) => {
    firstSourceChunkRequests += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chunks: [
          {
            chunkId: "chunk_first",
            documentId: "doc_first",
            sectionPath: "Root",
            type: "text",
            content: "First report source content.",
            sourceTitle: "report.pdf",
          },
        ],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      }),
    })
  })
  await page.route("**/api/sources/source_second/chunks**", async (route) => {
    secondSourceChunkRequests += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chunks: [
          {
            chunkId: "chunk_second",
            documentId: "doc_second",
            sectionPath: "Root",
            type: "text",
            content: "Second report source content.",
            sourceTitle: "report.pdf",
          },
        ],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      }),
    })
  })

  await page.goto("/e2e/citation-dedupe")

  const chatPanel = page.getByTestId("desktop-chat-panel")
  const duplicateSourceLinks = chatPanel.getByRole("button", {
    name: "Open source report.pdf",
  })
  await expect(duplicateSourceLinks).toHaveCount(2)

  const secondSourceRequestsBeforeClick = secondSourceChunkRequests
  await duplicateSourceLinks.nth(1).click()
  await expect(page.getByText("Second report source content.")).toBeVisible()
  expect(secondSourceChunkRequests).toBeGreaterThan(
    secondSourceRequestsBeforeClick,
  )

  await duplicateSourceLinks.first().click()
  await expect(page.getByText("First report source content.")).toBeVisible()
  expect(firstSourceChunkRequests).toBeGreaterThan(0)
})
