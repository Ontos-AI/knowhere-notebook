import { afterEach, describe, expect, it, vi } from "vitest";

import { postSourceUpload } from "./upload-request";

const mocks = vi.hoisted(() => ({
  uploadBlob: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  upload: mocks.uploadBlob,
}));

describe("postSourceUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploads the selected file to Blob before creating source metadata", async () => {
    let requestMethod = "";
    let requestPath = "";
    let requestBody: unknown = null;
    let requestContentType = "";
    const uploadedSource = {
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
      mimeType: "application/pdf",
      originalFile: {
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        mimeType: "application/pdf",
      },
    } as const;
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    const blob = {
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      downloadUrl:
        "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf?download=1",
      pathname: "source-uploads/upload_1/document.pdf",
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="document.pdf"',
      etag: "etag_1",
    };

    vi.stubGlobal("location", { origin: "http://localhost" });
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    mocks.uploadBlob.mockResolvedValue(blob);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      requestPath = new URL(request.url).pathname;
      requestMethod = request.method;
      requestContentType = request.headers.get("content-type") ?? "";
      if (requestContentType.includes("application/json")) {
        requestBody = await request.json();
      }

      return Response.json({ source: uploadedSource }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await postSourceUpload(file);

    expect(result).toEqual({
      status: 201,
      body: { source: uploadedSource },
    });
    expect(mocks.uploadBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
      file,
      expect.objectContaining({
        access: "public",
        contentType: "application/pdf",
        handleUploadUrl: "/api/source-uploads/blob",
        multipart: true,
      }),
    );
    expect(requestPath).toBe("/api/sources");
    expect(requestMethod).toBe("POST");
    expect(requestContentType).toContain("application/json");
    expect(requestBody).toEqual({
      upload: {
        type: "blob",
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.size,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses a Blob staging upload for files that are too large for Vercel Function bodies", async () => {
    let requestMethod = "";
    let requestPath = "";
    let requestBody: unknown = null;
    let requestContentType = "";
    const uploadedSource = {
      id: "source_1",
      title: "large.pdf",
      status: "parsing",
    } as const;
    const file = new File([new Uint8Array(5 * 1024 * 1024)], "large.pdf", {
      type: "application/pdf",
    });
    const blob = {
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      downloadUrl: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf?download=1",
      pathname: "source-uploads/upload_1/document.pdf",
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="document.pdf"',
      etag: "etag_1",
    };

    vi.stubGlobal("location", { origin: "http://localhost" });
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    mocks.uploadBlob.mockResolvedValue(blob);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      requestPath = new URL(request.url).pathname;
      requestMethod = request.method;
      requestContentType = request.headers.get("content-type") ?? "";
      if (requestContentType.includes("application/json")) {
        requestBody = await request.json();
      }

      return Response.json({ source: uploadedSource }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await postSourceUpload(file);

    expect(result).toEqual({
      status: 201,
      body: { source: uploadedSource },
    });
    expect(mocks.uploadBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
      file,
      expect.objectContaining({
        access: "public",
        contentType: "application/pdf",
        handleUploadUrl: "/api/source-uploads/blob",
        multipart: true,
      }),
    );
    expect(requestPath).toBe("/api/sources");
    expect(requestMethod).toBe("POST");
    expect(requestContentType).toContain("application/json");
    expect(requestBody).toEqual({
      upload: {
        type: "blob",
        pathname: "source-uploads/upload_1/document.pdf",
        url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
        fileName: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.size,
      },
    });
  });

  it("cleans up the staged Blob when the metadata handoff fails", async () => {
    const requestLog: Array<{
      readonly method: string;
      readonly path: string;
      readonly body: unknown;
    }> = [];
    const file = new File([new Uint8Array(5 * 1024 * 1024)], "large.pdf", {
      type: "application/pdf",
    });
    const blob = {
      url: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf",
      downloadUrl: "https://store.public.blob.vercel-storage.com/source-uploads/upload_1/document.pdf?download=1",
      pathname: "source-uploads/upload_1/document.pdf",
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="document.pdf"',
      etag: "etag_1",
    };

    vi.stubGlobal("location", { origin: "http://localhost" });
    vi.stubGlobal("crypto", { randomUUID: () => "upload_1" });
    mocks.uploadBlob.mockResolvedValue(blob);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      const path = new URL(request.url).pathname;
      const contentType = request.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await request.json()
        : null;
      requestLog.push({ method: request.method, path, body });

      if (request.method === "POST" && path === "/api/sources") {
        return Response.json({ message: "Upload failed." }, { status: 500 });
      }

      return Response.json({ ok: true }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await postSourceUpload(file);

    expect(result.status).toBe(500);
    expect(requestLog).toContainEqual({
      method: "DELETE",
      path: "/api/source-uploads/blob",
      body: { pathname: "source-uploads/upload_1/document.pdf" },
    });
  });

  it("uploads directly via multipart when Blob is not configured, targeting the chosen workspace", async () => {
    let requestPath = "";
    let requestMethod = "";
    let requestBody: FormData | null = null;
    const uploadedSource = {
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
      mimeType: "application/pdf",
      originalFile: {
        url: "https://example.com/source-uploads/notes.pdf",
        mimeType: "application/pdf",
      },
    } as const;
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    vi.stubGlobal("location", { origin: "http://localhost" });
    const fetch = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), "http://localhost").toString(), init);
      requestPath = new URL(request.url).pathname;
      requestMethod = request.method;
      requestBody = (await request.formData()) as FormData;
      return Response.json({ source: uploadedSource }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await postSourceUpload(file, false, "workspace_2");

    expect(result.status).toBe(201);
    expect(mocks.uploadBlob).not.toHaveBeenCalled();
    expect(requestPath).toBe("/api/sources");
    expect(requestMethod).toBe("POST");
    expect((requestBody as FormData | null)?.get("file")).toEqual(file);
    expect((requestBody as FormData | null)?.get("workspaceId")).toBe("workspace_2");
  });

  it("uploads directly via multipart without a workspace override when none is chosen", async () => {
    let requestBody: FormData | null = null;
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    vi.stubGlobal("location", { origin: "http://localhost" });
    const fetch = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (_input, init) => {
      const request = init
        ? new Request("http://localhost/api/sources", init)
        : new Request("http://localhost/api/sources");
      requestBody = (await request.formData()) as FormData;
      return Response.json({ source: { id: "source_1" } }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await postSourceUpload(file, false);

    expect(result.status).toBe(201);
    expect((requestBody as FormData | null)?.get("file")).toEqual(file);
    expect((requestBody as FormData | null)?.get("workspaceId")).toBeNull();
  });
});
