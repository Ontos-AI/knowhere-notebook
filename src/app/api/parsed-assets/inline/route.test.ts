import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAuthenticated: vi.fn(),
  getBlob: vi.fn(),
}))

vi.mock("@/domains/workspace/request-context", () => ({
  notebookRequestContext: {
    getAuthenticated: mocks.getAuthenticated,
  },
}))

vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  get: mocks.getBlob,
}))

import { GET } from "./route"

describe("GET /api/parsed-assets/inline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAuthenticated.mockResolvedValue({
      workspace: { id: "workspace_1" },
    })
  })

  it("serves Notebook parsed document image blobs inline", async () => {
    const assetUrl =
      "https://store.public.blob.vercel-storage.com/workspaces/workspace_1/parsed-documents/doc_1/rev_1/page_citation_assets/page-1.png"
    mocks.getBlob.mockResolvedValue({
      statusCode: 200,
      stream: new Response("image bytes").body,
      blob: {
        contentType: "image/png",
      },
    })

    const response = await GET(
      new NextRequest(
        `http://localhost:3001/api/parsed-assets/inline?url=${encodeURIComponent(
          assetUrl,
        )}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-disposition")).toBe("inline")
    await expect(response.text()).resolves.toBe("image bytes")
    expect(mocks.getBlob).toHaveBeenCalledWith(
      "workspaces/workspace_1/parsed-documents/doc_1/rev_1/page_citation_assets/page-1.png",
      { access: "public" },
    )
  })

  it("rejects blob URLs outside the authenticated workspace", async () => {
    const assetUrl =
      "https://store.public.blob.vercel-storage.com/workspaces/workspace_2/parsed-documents/doc_1/rev_1/page_citation_assets/page-1.png"

    const response = await GET(
      new NextRequest(
        `http://localhost:3001/api/parsed-assets/inline?url=${encodeURIComponent(
          assetUrl,
        )}`,
      ),
    )

    expect(response.status).toBe(404)
    expect(mocks.getBlob).not.toHaveBeenCalled()
  })

  it("does not serve non-image parsed assets through the inline image route", async () => {
    const assetUrl =
      "https://store.public.blob.vercel-storage.com/workspaces/workspace_1/sources/source_1/parsed-result/tables/table-1.html"
    mocks.getBlob.mockResolvedValue({
      statusCode: 200,
      stream: new Response("<table></table>").body,
      blob: {
        contentType: "text/html; charset=utf-8",
      },
    })

    const response = await GET(
      new NextRequest(
        `http://localhost:3001/api/parsed-assets/inline?url=${encodeURIComponent(
          assetUrl,
        )}`,
      ),
    )

    expect(response.status).toBe(415)
  })
})
