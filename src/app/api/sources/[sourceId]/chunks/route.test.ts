import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureApiKeyForWorkspace: vi.fn(),
  ensureWorkspace: vi.fn(),
  findSourceInWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  getSourceParseAssetUrls: vi.fn(),
  makeKnowhereClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}));

vi.mock("@/lib/api-key-service", () => ({
  ensureApiKeyForWorkspace: mocks.ensureApiKeyForWorkspace,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/knowhere", () => ({
  makeKnowhereClient: mocks.makeKnowhereClient,
}));

vi.mock("@/lib/workspace", () => ({
  ensureWorkspace: mocks.ensureWorkspace,
  findSourceInWorkspace: mocks.findSourceInWorkspace,
  getSourceParseAssetUrls: mocks.getSourceParseAssetUrls,
}));

import { GET } from "./route";

describe("GET /api/sources/[sourceId]/chunks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves bundled chunks for persisted demo sources without calling Knowhere", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
    mocks.ensureWorkspace.mockResolvedValue({ id: "workspace_1" });
    mocks.findSourceInWorkspace.mockResolvedValue({
      id: "source_demo",
      demoKey: "demo-tsla-q4-2025",
      knowhereDocumentId: "demo-doc-tsla-q4-2025",
    });

    const response = await GET(
      new NextRequest("http://localhost:3001/api/sources/source_demo/chunks?page=1&pageSize=1"),
      { params: Promise.resolve({ sourceId: "source_demo" }) },
    );

    await expect(response.json()).resolves.toMatchObject({
      chunks: [
        {
          documentId: "demo-doc-tsla-q4-2025",
          sourceTitle: "TSLA-Q4-2025-Update.pdf",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 1,
        total: 71,
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.ensureApiKeyForWorkspace).not.toHaveBeenCalled();
    expect(mocks.makeKnowhereClient).not.toHaveBeenCalled();
    expect(mocks.getSourceParseAssetUrls).not.toHaveBeenCalled();
  });
});
