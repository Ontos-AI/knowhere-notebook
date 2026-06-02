import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_UPLOAD_BYTES } from "@/domains/sources/validation";

const mocks = vi.hoisted(() => ({
  deleteBlob: vi.fn(),
  getCurrentUser: vi.fn(),
  handleUpload: vi.fn(),
}));

vi.mock("@/infrastructure/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@vercel/blob", () => ({
  del: mocks.deleteBlob,
}));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: mocks.handleUpload,
}));

import { DELETE, POST } from "./route";

describe("POST /api/source-uploads/blob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
  });

  it("generates a public client-upload token capped at the document upload limit", async () => {
    mocks.handleUpload.mockImplementation(async (options) => {
      const tokenOptions = await options.onBeforeGenerateToken(
        "source-uploads/upload_1/document.pdf",
        JSON.stringify({
          fileName: "large.pdf",
          mimeType: "application/pdf",
          sizeBytes: MAX_UPLOAD_BYTES,
        }),
        true,
      );

      return {
        type: "blob.generate-client-token",
        clientToken: "client_token_1",
        tokenOptions,
      };
    });

    const requestBody = {
      type: "blob.generate-client-token",
      payload: {
        pathname: "source-uploads/upload_1/document.pdf",
        multipart: true,
        clientPayload: JSON.stringify({
          fileName: "large.pdf",
          mimeType: "application/pdf",
          sizeBytes: MAX_UPLOAD_BYTES,
        }),
      },
    };

    const response = await POST(
      new NextRequest("http://localhost:3001/api/source-uploads/blob", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      type: "blob.generate-client-token",
      clientToken: "client_token_1",
      tokenOptions: {
        addRandomSuffix: true,
        allowOverwrite: false,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        tokenPayload: JSON.stringify({
          userId: "user_1",
          fileName: "large.pdf",
          mimeType: "application/pdf",
          sizeBytes: MAX_UPLOAD_BYTES,
        }),
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.handleUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: requestBody,
        request: expect.any(NextRequest),
        onBeforeGenerateToken: expect.any(Function),
      }),
    );
  });

  it("rejects anonymous client upload token requests", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3001/api/source-uploads/blob", {
        method: "POST",
        body: JSON.stringify({
          type: "blob.generate-client-token",
          payload: {
            pathname: "source-uploads/upload_1/document.pdf",
            multipart: true,
            clientPayload: null,
          },
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      message: "Please log in to upload documents.",
    });
    expect(response.status).toBe(401);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("deletes a staged Blob upload for logged-in users", async () => {
    mocks.deleteBlob.mockResolvedValue(undefined);

    const response = await DELETE(
      new NextRequest("http://localhost:3001/api/source-uploads/blob", {
        method: "DELETE",
        body: JSON.stringify({
          pathname: "source-uploads/upload_1/document.pdf",
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      "source-uploads/upload_1/document.pdf",
    );
  });
});
