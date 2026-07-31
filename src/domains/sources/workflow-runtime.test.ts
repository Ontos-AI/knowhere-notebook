import { describe, expect, it, vi } from "vitest";

import { sourceWorkflowRuntime } from "./workflow-runtime";
import type { Source } from "@/infrastructure/db/schema";

describe("sourceWorkflowRuntime", () => {
  it("creates an upload repository that turns missing source rows into invariant errors", async () => {
    const runtime = {
      createUploading: vi.fn(async () => makeSource("uploading")),
      markFailed: vi.fn(async () => makeSource("failed")),
      markParsing: vi.fn(async () => null),
    };

    const repository = sourceWorkflowRuntime.createUploadRepository(runtime);

    await expect(
      repository.markSourceParsing("workspace_1", "source_1", "job_1"),
    ).rejects.toThrow("Source disappeared before parsing.");
    await expect(
      repository.markSourceFailed("workspace_1", "source_1", "failed"),
    ).resolves.toMatchObject({ status: "failed" });
  });
});

function makeSource(status: Source["status"]): Source {
  return {
    id: "source_1",
    workspaceId: "workspace_1",
    title: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status,
    failureReason: status === "failed" ? "failed" : null,
    knowhereJobId: status === "parsing" ? "job_1" : null,
    knowhereDocumentId: status === "ready" ? "document_1" : null,
    stagedBlobPathname: null,
    stagedBlobUrl: null,
    originalBlobPathname: null,
    originalBlobUrl: null,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    deletedAt: null,
  };
}
