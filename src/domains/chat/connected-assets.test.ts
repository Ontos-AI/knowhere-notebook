import type { Documents } from "@ontos-ai/knowhere-sdk"
import { describe, expect, it, vi } from "vitest"

import { createConnectedAssetResolver } from "./connected-assets"

describe("createConnectedAssetResolver", () => {
  it("pages asset chunks by type and matches parser chunk ids", async () => {
    const listChunks = vi.fn(async (
      documentId: string,
      params?: {
        page?: number
        chunkType?: "image" | "table"
        includeAssetUrls?: boolean
      },
    ) => {
      const page = params?.page ?? 1
      const chunkType = params?.chunkType
      const chunks =
        chunkType === "table" && page === 2
          ? [{
              id: "dchk_table",
              chunkId: "parser_table",
              chunkType: "table" as const,
              sortOrder: 1,
              metadata: {},
              assetUrl: "https://assets.example/table.html",
            }]
          : chunkType === "image"
            ? [{
                id: "dchk_image",
                chunkId: "parser_image",
                chunkType: "image" as const,
                sortOrder: 1,
                metadata: {},
                assetUrl: "https://assets.example/image.jpg",
              }]
            : []
      return {
        documentId,
        namespace: "default",
        chunks,
        pagination: {
          page,
          pageSize: 200,
          total: chunks.length,
          totalPages: chunkType === "table" ? 2 : 1,
        },
      }
    })
    const resolveConnectedAssets = createConnectedAssetResolver({
      listChunks,
    } as unknown as Pick<Documents, "listChunks">)

    const result = await resolveConnectedAssets([
      { documentId: "doc_1", chunkId: "parser_table", type: "table" },
      { documentId: "doc_1", chunkId: "parser_image", type: "image" },
    ])

    expect(result).toEqual([
      {
        documentId: "doc_1",
        chunkId: "parser_table",
        type: "table",
        assetUrl: "https://assets.example/table.html",
      },
      {
        documentId: "doc_1",
        chunkId: "parser_image",
        type: "image",
        assetUrl: "https://assets.example/image.jpg",
      },
    ])
    expect(listChunks).toHaveBeenCalledWith("doc_1", {
      page: 1,
      pageSize: 200,
      chunkType: "table",
      includeAssetUrls: true,
    })
    expect(listChunks).toHaveBeenCalledWith("doc_1", {
      page: 2,
      pageSize: 200,
      chunkType: "table",
      includeAssetUrls: true,
    })
  })
})
