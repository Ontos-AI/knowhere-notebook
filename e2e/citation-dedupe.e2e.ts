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

test("keeps two chips to the same title/pN as separate buttons", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "playwright",
      url: "http://localhost:3000",
    },
  ])

  await page.goto("/e2e/citation-same-page")

  const chatPanel = page.getByTestId("desktop-chat-panel")
  await expect(chatPanel.getByTestId("citation-chip")).toHaveCount(2)
  await expect(
    chatPanel.getByRole("button", { name: "Open source spacex-s1.pdf/p26" }),
  ).toHaveCount(2)
})

test("draws citation regions instead of a full-page highlight", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "playwright",
      url: "http://localhost:3000",
    },
  ])
  await page.setViewportSize({ width: 1280, height: 832 })
  let releasePageImage = (): void => {}
  const pageImageGate = new Promise<void>((resolve) => {
    releasePageImage = resolve
  })
  await page.route(
    "**/images/knowhere/logo-icon.png?citation-test=slow",
    async (route) => {
      await pageImageGate
      await route.continue()
    },
  )
  await page.route("**/api/sources/source_spacex/chunks**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chunks: [
          {
            chunkId: "page_26",
            documentId: "doc_spacex",
            sectionPath: "Page 26",
            type: "page",
            content: "Revenue evidence on page 26.",
            readableContent: "Revenue evidence on page 26.",
            pageNums: [26],
            pageAssets: [
              {
                pageNumber: 26,
                assetUrl:
                  "/images/knowhere/logo-icon.png?citation-test=slow",
                contentType: "image/png",
                width: 1000,
                height: 1400,
              },
            ],
            sourceTitle: "spacex-s1.pdf",
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

  await page.goto("/e2e/citation-same-page")
  const chips = page
    .getByTestId("desktop-chat-panel")
    .getByTestId("citation-chip")
  await expect(chips).toHaveCount(2)

  await chips.first().click()
  const firstRegions = page.getByTestId("citation-region-highlight")
  const pageImage = page.getByRole("img", { name: "Page 26" })
  await expect(pageImage).toBeAttached()
  await expect
    .poll(() =>
      pageImage.evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
    )
    .toBe(false)
  await expect(firstRegions).toHaveCount(0)

  releasePageImage()

  await expect
    .poll(() =>
      pageImage.evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
    )
    .toBe(true)
  await expect(firstRegions).toHaveCount(1)
  await expect
    .poll(() =>
      firstRegions.first().evaluate((element) => ({
        left: element.style.left,
        top: element.style.top,
        width: element.style.width,
        height: element.style.height,
      })),
    )
    .toEqual({ left: "12%", top: "18%", width: "46%", height: "8%" })
  await expect(pageImage).toBeVisible()
  const imageBox = await pageImage.boundingBox()
  const firstRegionBox = await firstRegions.first().boundingBox()
  expect(imageBox).not.toBeNull()
  expect(firstRegionBox).not.toBeNull()
  expect(firstRegionBox!.x).toBeCloseTo(
    imageBox!.x + imageBox!.width * 0.12,
    1,
  )
  expect(firstRegionBox!.y).toBeCloseTo(
    imageBox!.y + imageBox!.height * 0.18,
    1,
  )
  expect(firstRegionBox!.width).toBeCloseTo(imageBox!.width * 0.46, 1)
  expect(firstRegionBox!.height).toBeCloseTo(imageBox!.height * 0.08, 1)

  await chips.nth(1).click()
  const secondRegions = page.getByTestId("citation-region-highlight")
  await expect(secondRegions).toHaveCount(2)
  const regionStyles = await secondRegions.evaluateAll((elements) =>
    elements.map((element) => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
      width: (element as HTMLElement).style.width,
      height: (element as HTMLElement).style.height,
    })),
  )
  expect(regionStyles).toEqual([
    { left: "62%", top: "52%", width: "24%", height: "6%" },
    { left: "15%", top: "68%", width: "32%", height: "5%" },
  ])
  expect(regionStyles).not.toContainEqual({
    left: "0%",
    top: "0%",
    width: "100%",
    height: "100%",
  })
  const expectedSecondRegions = [
    { x: 0.62, y: 0.52, w: 0.24, h: 0.06 },
    { x: 0.15, y: 0.68, w: 0.32, h: 0.05 },
  ]
  for (const [index, expectedRegion] of expectedSecondRegions.entries()) {
    const regionBox = await secondRegions.nth(index).boundingBox()
    expect(regionBox).not.toBeNull()
    expect(regionBox!.x).toBeCloseTo(
      imageBox!.x + imageBox!.width * expectedRegion.x,
      1,
    )
    expect(regionBox!.y).toBeCloseTo(
      imageBox!.y + imageBox!.height * expectedRegion.y,
      1,
    )
    expect(regionBox!.width).toBeCloseTo(
      imageBox!.width * expectedRegion.w,
      1,
    )
    expect(regionBox!.height).toBeCloseTo(
      imageBox!.height * expectedRegion.h,
      1,
    )
  }
})

test("moves a deduplicated cited page to the top from the same source", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "playwright",
      url: "http://localhost:3000",
    },
  ])
  await page.setViewportSize({ width: 1280, height: 832 })
  await page.route("**/api/sources/source_spacex/chunks**", async (route) => {
    const pageAsset = {
      pageNumber: 26,
      assetUrl: "/images/knowhere/logo-icon.png",
      contentType: "image/png",
      width: 1000,
      height: 1400,
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chunks: [
          {
            chunkId: "page_1",
            documentId: "doc_spacex",
            sectionPath: "Page 1",
            type: "page",
            content: "Content from page 1.",
            readableContent: "Content from page 1.",
            pageNums: [1],
            pageAssets: [{ ...pageAsset, pageNumber: 1 }],
            sourceTitle: "spacex-s1.pdf",
          },
          {
            chunkId: "page_26_first_section",
            documentId: "doc_spacex",
            sectionPath: "Page 26 / First section",
            type: "page",
            content: "Other content from page 26.",
            readableContent: "Other content from page 26.",
            pageNums: [26],
            pageAssets: [pageAsset],
            sourceTitle: "spacex-s1.pdf",
          },
          {
            chunkId: "page_26_cited_section",
            documentId: "doc_spacex",
            sectionPath: "Page 26",
            type: "page",
            content: "Revenue evidence on page 26.",
            readableContent: "Revenue evidence on page 26.",
            pageNums: [26],
            pageAssets: [pageAsset],
            sourceTitle: "spacex-s1.pdf",
          },
        ],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 3,
          totalPages: 1,
        },
      }),
    })
  })

  await page.goto("/e2e/citation-same-page")
  await page
    .getByTestId("desktop-sources-panel")
    .getByRole("button", { name: "Open spacex-s1.pdf parsed chunks" })
    .click()
  const chunksPanel = page.getByTestId("desktop-chunks-panel")
  await chunksPanel.getByRole("button", { name: "List" }).click()
  await expect
    .poll(() =>
      chunksPanel
        .locator('[data-index="0"]')
        .getAttribute("data-chunk-id"),
    )
    .toBe("page_1")

  await page
    .getByTestId("desktop-chat-panel")
    .getByTestId("citation-chip")
    .first()
    .click()

  await expect
    .poll(() =>
      chunksPanel
        .locator('[data-index="0"]')
        .getAttribute("data-chunk-id"),
    )
    .toBe("page_26_first_section")
  await expect(page.getByTestId("citation-region-highlight")).toHaveCount(1)
})
