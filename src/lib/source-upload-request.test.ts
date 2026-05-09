import { afterEach, describe, expect, it, vi } from "vitest";

import { postSourceUpload } from "./source-upload-request";

describe("postSourceUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the selected file as multipart form data through the Effect HTTP client", async () => {
    let requestMethod = "";
    let requestPath = "";
    let uploadedFileName = "";
    const uploadedSource = {
      id: "source_1",
      title: "notes.pdf",
      status: "parsing",
    } as const;
    vi.stubGlobal("location", { origin: "http://localhost" });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").toString(), init);
      const formData = await request.formData();
      const file = formData.get("file");

      requestPath = new URL(request.url).pathname;
      requestMethod = request.method;
      uploadedFileName =
        typeof file === "object" && file !== null && "name" in file
          ? String(file.name)
          : "";

      return Response.json({ source: uploadedSource }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await postSourceUpload(
      new File(["hello"], "notes.pdf", { type: "application/pdf" }),
    );

    expect(result).toEqual({
      status: 201,
      body: { source: uploadedSource },
    });
    expect(requestPath).toBe("/api/sources");
    expect(requestMethod).toBe("POST");
    expect(uploadedFileName).toBe("notes.pdf");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
