import { describe, expect, it } from "vitest"

import { sourceRouteUploadRequest } from "./route-upload-request"

describe("sourceRouteUploadRequest", () => {
  it("reads multipart Source Upload files", async () => {
    const formData = new FormData()
    const file = new File(["hello"], "notes.pdf", {
      type: "application/pdf",
    })
    formData.set("file", file)

    await expect(
      sourceRouteUploadRequest.read(
        new Request("http://localhost/api/sources", {
          method: "POST",
          body: formData,
        }),
      ),
    ).resolves.toEqual({ type: "file", file })
  })

  it("reads Blob-backed Source Upload handoff bodies", async () => {
    await expect(
      sourceRouteUploadRequest.read(
        new Request("http://localhost/api/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            upload: {
              type: "blob",
              pathname: "source-uploads/upload_1/document.pdf",
              url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
              fileName: "large.pdf",
              mimeType: "application/pdf",
              sizeBytes: 5 * 1024 * 1024,
            },
          }),
        }),
      ),
    ).resolves.toEqual({
      type: "blob",
      input: {
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5 * 1024 * 1024,
      },
    })
  })
})
