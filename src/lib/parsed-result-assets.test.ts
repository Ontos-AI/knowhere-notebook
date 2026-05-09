import { describe, expect, it, vi } from "vitest"
import type { JobResult } from "@ontos-ai/knowhere-sdk"

import { storeParsedResultAssets } from "./parsed-result-assets"

describe("storeParsedResultAssets", () => {
  it("stores the result zip and extracted media assets in blob storage", async () => {
    const uploaded: Array<{
      pathname: string
      body: Buffer | string
      contentType: string
    }> = []
    const rawZip = Buffer.from("zip bytes")
    const imageData = Buffer.from("jpg bytes")
    const job = makeJobResult()
    const client = {
      jobs: {
        load: vi.fn().mockResolvedValue({
          rawZip,
          imageChunks: [
            {
              filePath: "images/image-1.jpg",
              data: imageData,
            },
            {
              filePath: "../private.jpg",
              data: Buffer.from("invalid"),
            },
          ],
          tableChunks: [
            {
              filePath: "tables/table-1.html",
              html: "<table><tbody><tr><td>One</td></tr></tbody></table>",
            },
          ],
        }),
      },
    }
    const blobStore = {
      put: vi.fn(
        async (
          pathname: string,
          body: Buffer | string,
          options: { contentType: string },
        ) => {
          uploaded.push({ pathname, body, contentType: options.contentType })
          return { url: `https://blob.example/${pathname}` }
        },
      ),
    }

    const stored = await storeParsedResultAssets({
      workspaceId: "workspace_1",
      sourceId: "source_1",
      job,
      client,
      blobStore,
    })

    expect(client.jobs.load).toHaveBeenCalledWith(job)
    expect(uploaded).toEqual([
      {
        pathname:
          "workspaces/workspace_1/sources/source_1/parsed-result/result.zip",
        body: rawZip,
        contentType: "application/zip",
      },
      {
        pathname:
          "workspaces/workspace_1/sources/source_1/parsed-result/images/image-1.jpg",
        body: imageData,
        contentType: "image/jpeg",
      },
      {
        pathname:
          "workspaces/workspace_1/sources/source_1/parsed-result/tables/table-1.html",
        body: "<table><tbody><tr><td>One</td></tr></tbody></table>",
        contentType: "text/html; charset=utf-8",
      },
    ])
    expect(stored).toEqual({
      resultBlobUrl:
        "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/result.zip",
      assetUrlsByFilePath: {
        "images/image-1.jpg":
          "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/images/image-1.jpg",
        "tables/table-1.html":
          "https://blob.example/workspaces/workspace_1/sources/source_1/parsed-result/tables/table-1.html",
      },
    })
  })
})

function makeJobResult(): JobResult {
  return {
    jobId: "job_1",
    status: "done",
    sourceType: "file",
    namespace: "notebook-workspace_1",
    documentId: "doc_1",
    createdAt: new Date("2026-05-06T00:00:00Z"),
    isDone: true,
    isFailed: false,
    isTerminal: true,
  }
}
