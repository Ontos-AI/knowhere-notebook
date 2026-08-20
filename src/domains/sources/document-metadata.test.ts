import { describe, expect, it } from "vitest"

import {
  createNotebookDocumentMetadata,
  getCreatedByClient,
  isNotebookVisibleRemoteClient,
  isNotebookVisibleRemoteMetadata,
  NOTEBOOK_DOCUMENT_METADATA_DEFAULTS,
  NOTEBOOK_VISIBLE_CREATED_BY_CLIENTS,
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

  it("reads camelCase and snake_case created-by-client metadata", () => {
    expect(getCreatedByClient({ createdByClient: "cli" })).toBe("cli")
    expect(getCreatedByClient({ created_by_client: "mcp" })).toBe("mcp")
    expect(getCreatedByClient({})).toBeUndefined()
    expect(getCreatedByClient(undefined)).toBeUndefined()
  })

  it("allowlists notebook, cli, and mcp remote documents", () => {
    expect(NOTEBOOK_VISIBLE_CREATED_BY_CLIENTS).toEqual([
      "notebook",
      "cli",
      "mcp",
    ])
    expect(isNotebookVisibleRemoteClient("notebook")).toBe(true)
    expect(isNotebookVisibleRemoteClient("cli")).toBe(true)
    expect(isNotebookVisibleRemoteClient("mcp")).toBe(true)
    expect(isNotebookVisibleRemoteClient("node-sdk")).toBe(false)
    expect(isNotebookVisibleRemoteClient("api")).toBe(false)
    expect(isNotebookVisibleRemoteClient(undefined)).toBe(false)
    expect(isNotebookVisibleRemoteMetadata({ createdByClient: "cli" })).toBe(
      true,
    )
    expect(isNotebookVisibleRemoteMetadata({ created_by_client: "api" })).toBe(
      false,
    )
    expect(isNotebookVisibleRemoteMetadata({})).toBe(false)
  })
})
