import { describe, expect, it } from "vitest";

import type { Source } from "./schema";
import { toSourceView } from "./source-view";

function makeSource(overrides: Partial<Source>): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    status: "ready",
    failureReason: null,
    knowhereJobId: "job_1",
    knowhereDocumentId: "doc_1",
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("toSourceView", () => {
  it("maps database source metadata to the sidebar view shape", () => {
    expect(toSourceView(makeSource({}), { chunkCount: 7 })).toEqual({
      id: "source_1",
      title: "notes.pdf",
      status: "ready",
      documentId: "doc_1",
      chunkCount: 7,
    });
  });

  it("does not expose internal job ids or failure internals", () => {
    expect(
      toSourceView(
        makeSource({
          status: "parsing",
          knowhereDocumentId: null,
          failureReason: "internal stack trace",
        }),
      ),
    ).toEqual({
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
      documentId: undefined,
    });
  });
});
