import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"

type ComposerViewport = {
  readonly name: string
  readonly width: number
  readonly height: number
}

const composerRegressionViewports: readonly ComposerViewport[] = [
  { name: "desktop", width: 1280, height: 832 },
  { name: "mobile", width: 390, height: 844 },
]

const longResearchPrompt = [
  "You are a sell-side research analyst preparing a post earnings flash note.",
  "Please complete the following tasks:",
  "1. Extract management's original wording on revenue guidance, gross margin, and capex.",
  "2. Compare the wording with the prior quarter and call out any directional changes.",
  "3. Summarize the implications in concise bullets for institutional investors.",
  "4. Include source-backed evidence for each conclusion.",
].join("\n")

test("fits desktop notebook panels inside a 13-inch viewport", async ({
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
  await page.goto("/e2e/citation-dedupe")

  const layout = page.getByTestId("desktop-panel-layout")
  const chatPanel = page.getByTestId("desktop-chat-panel")
  await expect(layout).toBeVisible()

  await expect
    .poll(async () => {
      return layout.evaluate((element) => {
        return element.scrollWidth <= element.clientWidth
      })
    })
    .toBe(true)

  const measurements = await layout.evaluate((element) => {
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }
  })
  const chatBounds = await chatPanel.boundingBox()

  expect(measurements.scrollWidth).toBeLessThanOrEqual(
    measurements.clientWidth,
  )
  expect(chatBounds?.x).toBeGreaterThanOrEqual(0)
  expect((chatBounds?.x ?? 0) + (chatBounds?.width ?? 0)).toBeLessThanOrEqual(
    measurements.clientWidth,
  )
})

test("uses the tabbed notebook layout below the desktop panel minimum", async ({
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
  await page.setViewportSize({ width: 1099, height: 832 })
  await page.goto("/e2e/citation-dedupe")

  await expect(page.getByTestId("desktop-panel-layout")).toBeHidden()
  await expect(
    page.getByRole("tab", {
      name: /Chat/u,
    }),
  ).toBeVisible()
})

for (const viewport of composerRegressionViewports) {
  test(`keeps long chat prompts clear of composer actions on ${viewport.name}`, async ({
    context,
    page,
  }) => {
    await openAuthenticatedNotebook(context, page, viewport)

    const input = page.getByRole("textbox", { name: "Chat message" })
    const sendButton = page.getByRole("button", { name: "Send message" })

    await expect(input).toBeVisible()
    await input.fill(longResearchPrompt)
    await expect(sendButton).toBeVisible()
    await expect(sendButton).toBeEnabled()

    const inputBounds = await getRequiredBounds(input, "chat composer input")
    const sendBounds = await getRequiredBounds(sendButton, "send button")

    expect(inputBounds.y + inputBounds.height).toBeLessThanOrEqual(sendBounds.y)
  })

  test(`keeps the first prompt placeholder selected after menu close on ${viewport.name}`, async ({
    context,
    page,
  }) => {
    await openAuthenticatedNotebook(context, page, viewport)

    const input = page.getByRole("textbox", { name: "Chat message" })
    await page.getByRole("button", { name: "Create" }).click()
    await page
      .getByRole("menuitem", { name: "Earnings Call Transcript Analysis" })
      .click()

    await expect(input).toBeFocused()
    await expect
      .poll(async () => getSelectedComposerText(input))
      .toBe("[Company Name]")

    await page.waitForTimeout(400)

    await expect(input).toBeFocused()
    expect(await getSelectedComposerText(input)).toBe("[Company Name]")
    expect(
      await input.evaluate((element) => {
        return element.scrollTop
      }),
    ).toBe(0)
  })
}

async function openAuthenticatedNotebook(
  context: BrowserContext,
  page: Page,
  viewport: ComposerViewport,
): Promise<void> {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "playwright",
      url: "http://localhost:3000",
    },
  ])
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.goto("/e2e/citation-dedupe")
}

async function getRequiredBounds(
  locator: Locator,
  label: string,
): Promise<Readonly<{ x: number; y: number; width: number; height: number }>> {
  const bounds = await locator.boundingBox()

  expect(bounds, `${label} should have a bounding box`).not.toBeNull()
  if (bounds === null) {
    throw new Error(`${label} did not have a bounding box.`)
  }

  return bounds
}

async function getSelectedComposerText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      throw new Error("Expected chat composer input to be a textarea.")
    }

    return element.value.slice(element.selectionStart, element.selectionEnd)
  })
}
