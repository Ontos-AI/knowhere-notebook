import { expect, test } from "@playwright/test"

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
      name: /Assistant/u,
    }),
  ).toBeVisible()
})
