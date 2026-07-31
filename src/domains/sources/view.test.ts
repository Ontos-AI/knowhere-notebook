import { describe, expect, it } from "vitest";

import type { Source } from "@/infrastructure/db/schema";
import { toSourceView } from "./view";

function makeSource(overrides: Partial<Source> = {}): Source {
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
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("toSourceView", () => {
  it("maps database source metadata to the sidebar view shape", () => {
    expect(
      toSourceView(
        makeSource({
          originalBlobPathname: "source-uploads/upload_1/document.pdf",
          originalBlobUrl:
            "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        }),
        { chunkCount: 7 },
      ),
    ).toEqual({
      id: "source_1",
      kind: "workspace",
      title: "notes.pdf",
      mimeType: "application/pdf",
      status: "ready",
      documentId: "doc_1",
      chunkCount: 7,
      originalFile: {
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
      },
    });
  });

  it("does not expose internal job ids or non-failed failure internals", () => {
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
      kind: "workspace",
      title: "notes.pdf",
      mimeType: "application/pdf",
      status: "parsing",
      documentId: undefined,
    });
  });

  it("exposes a brief failed message for failed source rows", () => {
    expect(
      toSourceView(
        makeSource({
          status: "failed",
          knowhereDocumentId: null,
          failureReason:
            "Retry attempt 1 for POST /v1/jobs: Error [RateLimitError]: Too many concurrent requests (2/2 active). Please retry after 30 seconds.\n    at iM.handleError",
        }),
      ),
    ).toEqual({
      id: "source_1",
      kind: "workspace",
      title: "notes.pdf",
      mimeType: "application/pdf",
      status: "failed",
      failureMessage:
        "Too many concurrent requests (2/2 active). Please retry after 30 seconds.",
      documentId: undefined,
    });
  });

});
