const pdfPageWidth = 612
const pdfPageHeight = 792
const pdfMargin = 54
const pdfFontSize = 11
const pdfLineHeight = 14
const pdfCharsPerLine = 90

export async function downloadAnswerPdf(
  filename: string,
  markdown: string,
): Promise<void> {
  const blob = createPdfBlobFromMarkdown(markdown)
  downloadBlob(filename, blob)
}

export function createPdfBlobFromMarkdown(markdown: string): Blob {
  const lines = wrapPdfLines(toWinAnsi(markdown), pdfCharsPerLine)
  const linesPerPage = Math.max(
    1,
    Math.floor((pdfPageHeight - pdfMargin * 2) / pdfLineHeight),
  )
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage))
  const objects: string[] = []
  const pageObjectNumbers: number[] = []
  const fontObjectNumber = 3 + pageCount * 2

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageLines = lines.slice(
      pageIndex * linesPerPage,
      (pageIndex + 1) * linesPerPage,
    )
    const content = buildPageContent(pageLines)
    const contentObjectNumber = 3 + pageIndex * 2
    const pageObjectNumber = contentObjectNumber + 1
    objects.push(pdfObject(contentObjectNumber, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    objects.push(
      pdfObject(
        pageObjectNumber,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageWidth} ${pdfPageHeight}] /Contents ${contentObjectNumber} 0 R /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> >>`,
      ),
    )
    pageObjectNumbers.push(pageObjectNumber)
  }

  objects.unshift(
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(
      2,
      `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectNumbers
        .map((objectNumber) => `${objectNumber} 0 R`)
        .join(" ")}] >>`,
    ),
  )
  objects.push(
    pdfObject(fontObjectNumber, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  )

  return buildPdf(objects)
}

function buildPageContent(lines: readonly string[]): string {
  const commands = [
    "BT",
    `/F1 ${pdfFontSize} Tf`,
    `${pdfMargin} ${pdfPageHeight - pdfMargin} Td`,
    `${pdfLineHeight} TL`,
  ]
  for (const [index, line] of lines.entries()) {
    commands.push(`(${escapePdfLiteral(line)}) Tj`)
    if (index < lines.length - 1) commands.push("T*")
  }
  commands.push("ET")
  return commands.join("\n")
}

function wrapPdfLines(text: string, maxChars: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.length === 0) {
      lines.push("")
      continue
    }

    let remaining = paragraph
    while (remaining.length > maxChars) {
      let breakAt = remaining.lastIndexOf(" ", maxChars)
      if (breakAt < 1) breakAt = maxChars
      lines.push(remaining.slice(0, breakAt))
      remaining = remaining.slice(breakAt).trimStart()
    }
    lines.push(remaining)
  }
  return lines.length > 0 ? lines : [""]
}

function toWinAnsi(text: string): string {
  return Array.from(text, (character) =>
    character.charCodeAt(0) < 256 ? character : "?",
  ).join("")
}

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

function pdfObject(objectNumber: number, body: string): string {
  return `${objectNumber} 0 obj\n${body}\nendobj`
}

function buildPdf(objects: readonly string[]): Blob {
  const xrefOffsets: number[] = [0]
  let body = "%PDF-1.4\n"
  for (const object of objects) {
    xrefOffsets.push(body.length)
    body += `${object}\n`
  }
  const xrefStart = body.length
  const xrefEntries = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...xrefOffsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
  ]
  body += `${xrefEntries.join("\n")}\n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return new Blob([body], { type: "application/pdf" })
}

function downloadBlob(filename: string, blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
