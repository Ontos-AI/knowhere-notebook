import { describe, expect, it } from "vitest"

import type { Source } from "@/infrastructure/db/schema"
import { getRetrievalDocumentScope, isEmptyFolderScope } from "./retrieval"

describe("getRetrievalDocumentScope", () => {
  it("does not add includeDocumentIds at the workspace root", () => {
    expect(
      getRetrievalDocumentScope(
        [makeSource({ id: "source_1", knowhereDocumentId: "doc_1" })],
        [],
        {},
      ),
    ).toEqual({})
  })

  it("converts a folder scope into includeDocumentIds", () => {
    expect(
      getRetrievalDocumentScope(
        [
          makeSource({ id: "source_1", knowhereDocumentId: "doc_1" }),
          makeSource({ id: "source_2", knowhereDocumentId: "doc_2" }),
        ],
        [],
        {},
        ["source_1"],
      ),
    ).toEqual({
      includeDocumentIds: ["doc_1"],
    })
  })

  it("keeps row exclusions on top of a folder include list", () => {
    expect(
      getRetrievalDocumentScope(
        [
          makeSource({ id: "source_1", knowhereDocumentId: "doc_1" }),
          makeSource({ id: "source_2", knowhereDocumentId: "doc_2" }),
        ],
        ["source_2"],
        {},
        ["source_1", "source_2"],
      ),
    ).toEqual({
      includeDocumentIds: ["doc_1", "doc_2"],
      excludeDocumentIds: ["doc_2"],
    })
  })

  it("treats a missing or empty folder as an empty search scope", () => {
    expect(isEmptyFolderScope(undefined, [makeSource()])).toBe(false)
    expect(isEmptyFolderScope([], [makeSource()])).toBe(true)
    expect(isEmptyFolderScope(["source_missing"], [makeSource()])).toBe(true)
    expect(isEmptyFolderScope(["source_1"], [makeSource()])).toBe(false)
    expect(
      getRetrievalDocumentScope([makeSource()], [], {}, []),
    ).toEqual({
      includeDocumentIds: [],
    })
  })
})

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    status: "ready",
    failureReason: null,
    failureStage: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    demoKey: null,
    chunkCount: null,
    folderId: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  }
}
