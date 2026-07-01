import { describe, expect, it } from "vitest";

import { sourceRouteRequest } from "./route-request";

describe("sourceRouteRequest", () => {
  it("reads a valid archive request into route service input", async () => {
    const result = await sourceRouteRequest.readArchiveSource({
      cookieHeader: "session=abc",
      request: new Request("http://localhost/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      sourceId: "source_1",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        cookieHeader: "session=abc",
        sourceId: "source_1",
      },
    });
  });

  it("reads a valid retry request into route service input", async () => {
    const result = await sourceRouteRequest.readSourceMutation({
      cookieHeader: "session=abc",
      request: new Request("http://localhost/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ retry: true }),
      }),
      sourceId: "source_1",
    });

    expect(result).toEqual({
      ok: true,
      mutation: {
        kind: "retry",
        input: {
          cookieHeader: "session=abc",
          sourceId: "source_1",
        },
      },
    });
  });

  it("returns route-ready errors for invalid archive requests", async () => {
    const result = await sourceRouteRequest.readSourceMutation({
      cookieHeader: "",
      request: new Request("http://localhost/api/sources/source_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      }),
      sourceId: "source_1",
    });

    expect(result).toEqual({
      ok: false,
      result: {
        status: 400,
        body: {
          message: "Request body must include `archived: true` or `retry: true`.",
        },
      },
    });
  });
});
