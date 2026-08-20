import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"

import type { Source } from "@/infrastructure/db/schema"
import {
  isNotebookVisibleRemoteDocument,
  listRemoteLibrarySourceViews,
} from "./remote-library"

const localSource: Source = {
  id: "source_local",
  workspaceId: "workspace_1",
  title: "notes.pdf",
  mimeType: "application/pdf",
  sizeBytes: 5,
  status: "ready",
  failureReason: null,
  failureStage: null,
  knowhereJobId: null,
  knowhereDocumentId: "doc_local",
  stagedBlobPathname: null,
  stagedBlobUrl: null,
  originalBlobPathname: null,
  originalBlobUrl: null,
  demoKey: null,
  createdAt: new Date("2026-05-10T00:00:00Z"),
  updatedAt: new Date("2026-05-10T00:00:00Z"),
  deletedAt: null,
}

describe("listRemoteLibrarySourceViews", () => {
  it("keeps notebook, cli, and mcp remotes and hides other origins", async () => {
    const list = vi.fn(
      async (params?: { readonly namespace?: string }) => {
        if (params?.namespace !== "default") {
          return { documents: [] }
        }

        return {
          documents: [
          {
            documentId: "doc_cli",
            namespace: "default",
            status: "active",
            sourceFileName: "cli.pdf",
            documentMetadata: { createdByClient: "cli" },
          },
          {
            documentId: "doc_mcp",
            namespace: "default",
            status: "active",
            sourceFileName: "mcp.pdf",
            documentMetadata: { created_by_client: "mcp" },
          },
          {
            documentId: "doc_notebook",
            namespace: "default",
            status: "active",
            sourceFileName: "notebook.pdf",
            documentMetadata: { createdByClient: "notebook" },
          },
          {
            documentId: "doc_untagged",
            namespace: "default",
            status: "active",
            sourceFileName: "dummy.pdf",
          },
          {
            documentId: "doc_sdk",
            namespace: "default",
            status: "active",
            sourceFileName: "sdk.pdf",
            documentMetadata: { createdByClient: "node-sdk" },
          },
          {
            documentId: "doc_api",
            namespace: "default",
            status: "active",
            sourceFileName: "api.pdf",
            documentMetadata: { created_by_client: "api" },
          },
          {
            documentId: "doc_local",
            namespace: "default",
            status: "active",
            sourceFileName: "notes.pdf",
            documentMetadata: { createdByClient: "cli" },
          },
        ],
      }
    })

    const views = await Effect.runPromise(
      listRemoteLibrarySourceViews({
        workspace: { namespace: "notebook-workspace_1" },
        client: { documents: { list } },
        localSources: [localSource],
      }),
    )

    expect(views.map((view) => view.documentId)).toEqual([
      "doc_cli",
      "doc_mcp",
      "doc_notebook",
    ])
    expect(
      isNotebookVisibleRemoteDocument({
        documentMetadata: { createdByClient: "cli" },
      }),
    ).toBe(true)
    expect(
      isNotebookVisibleRemoteDocument({
        documentMetadata: {},
      }),
    ).toBe(false)
  })
})
