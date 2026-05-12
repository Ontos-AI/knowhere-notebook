import { expect, test, type Page } from "@playwright/test"

const unsupportedPreviewText = "Preview is not available for this file."

test("reopens the demo PDF preview after returning from original to parsed chunks", async ({
  page,
}) => {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Parsed Chunks" }),
  ).toBeVisible()

  await openFirstChunk(page)
  await expectDemoPdfPreview(page)

  await page
    .getByTestId("chunks-panel")
    .getByRole("button", { name: "Parsed", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Parsed Chunks" }),
  ).toBeVisible()

  await openFirstChunk(page)
  await expectDemoPdfPreview(page)
})

async function openFirstChunk(page: Page): Promise<void> {
  await page
    .locator('[data-testid^="chunk-card-shell-"]')
    .first()
    .getByRole("button", { name: "Open page 1" })
    .click()
  await expect(page.getByRole("heading", { name: "Original File" })).toBeVisible()
  await expect(page.getByTestId("source-original-preview")).toHaveAttribute(
    "data-target-page",
    "1",
  )
}

async function expectDemoPdfPreview(page: Page): Promise<void> {
  await expect(page.getByText(unsupportedPreviewText)).toBeHidden()
  await expect(page.locator("canvas.react-pdf__Page__canvas").first()).toBeVisible()
  await expect(page.getByText(unsupportedPreviewText)).toBeHidden()
}
