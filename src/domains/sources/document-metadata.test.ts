import { describe, expect, it } from "vitest"

import {
  createNotebookDocumentMetadata,
  NOTEBOOK_DOCUMENT_METADATA_DEFAULTS,
} from "./document-metadata"

describe("createNotebookDocumentMetadata", () => {
  it("attaches notebook client identity and display fields", () => {
    expect(
      createNotebookDocumentMetadata({
        title: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
      }),
    ).toEqual({
      createdByClient: "notebook",
      clientVersion: "0.1.0",
      sourceFileName: "notes.pdf",
      title: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
    })
  })

  it("lets caller overrides win for identity fields", () => {
    expect(
      createNotebookDocumentMetadata({
        title: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        overrides: {
          createdByClient: "api",
          clientVersion: "9.9.9",
        },
      }),
    ).toMatchObject({
      createdByClient: "api",
      clientVersion: "9.9.9",
    })
  })

  it("exports notebook defaults", () => {
    expect(NOTEBOOK_DOCUMENT_METADATA_DEFAULTS).toEqual({
      createdByClient: "notebook",
      clientVersion: "0.1.0",
    })
  })
})
