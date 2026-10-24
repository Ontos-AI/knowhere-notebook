import { expect, test, type Page } from "@playwright/test"

const unsupportedPreviewText = "Preview is not available for this file."

test("reopens the demo PDF preview after returning from original to parsed chunks", async ({
  context,
  page,
}) => {
  await context.addCookies([{ name: "better-auth.session_token", value: "playwright", url: "http://localhost:3000" }])
  await page.route("**/api/sources/demo-report/chunks**", async (route) => {
    await route.fulfill({ json: { chunks: [{ chunkId: "page-one", type: "text", content: "Report page one.", sourceTitle: "Shared report.pdf", pageNums: [1] }], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } } })
  })
  await page.route("**/api/demo-sources/demo-report/original**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("job_result_id")).toBe("revision-current")
    await route.fulfill({ contentType: "application/pdf", body: createPdfFixture() })
  })
  await page.goto("/e2e/shared-demo-chat")
  await expect(
    page.getByRole("heading", { name: "Parsed Results" }),
  ).toBeVisible()
  await expect(page.getByRole("treeitem", { name: "Report page one. Text · Page 1", exact: true })).toBeVisible()

  await openFirstChunk(page)
  await expectDemoPdfPreview(page)

  await page
    .getByTestId("chunks-panel")
    .getByRole("button", { name: "Parsed", exact: true })
    .click()
  await expect(
    page.getByRole("heading", { name: "Parsed Results" }),
  ).toBeVisible()

  await openFirstChunk(page)
  await expectDemoPdfPreview(page)
})

async function openFirstChunk(page: Page): Promise<void> {
  await page
    .getByTestId("chunks-panel")
    .getByRole("button", { name: "Original", exact: true })
    .click()
  await expect(page.getByRole("heading", { name: "Original File" })).toBeVisible()
}

async function expectDemoPdfPreview(page: Page): Promise<void> {
  await expect(page.getByText(unsupportedPreviewText)).toBeHidden()
  await expect(page.locator("canvas.react-pdf__Page__canvas").first()).toBeVisible()
  await expect(page.getByText(unsupportedPreviewText)).toBeHidden()
}

function createPdfFixture(): Buffer {
  const content: string = "BT /F1 16 Tf 40 100 Td (Notebook shared demo) Tj ET"
  const objects: readonly string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let document: string = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object: string, index: number): void => {
    offsets.push(Buffer.byteLength(document))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const crossReferenceOffset: number = Buffer.byteLength(document)
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets.map((offset: number): string => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`
  return Buffer.from(document)
}
