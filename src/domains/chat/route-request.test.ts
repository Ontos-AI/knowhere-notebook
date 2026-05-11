import { describe, expect, it } from "vitest";

import { chatRouteRequest } from "./route-request";

describe("chatRouteRequest", () => {
  it("rejects archive requests that do not explicitly set archived true", async () => {
    const result = await chatRouteRequest.readArchiveThread({
      request: new Request("http://localhost/api/chat/threads/thread_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      }),
      threadId: "thread_1",
    });

    expect(result).toEqual({
      ok: false,
      result: {
        status: 400,
        body: {
          message: "Request body must include `archived: true`.",
        },
      },
    });
  });

  it("reads a valid archive request into route service input", async () => {
    const result = await chatRouteRequest.readArchiveThread({
      request: new Request("http://localhost/api/chat/threads/thread_1", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
      threadId: "thread_1",
    });

    expect(result).toEqual({
      ok: true,
      input: {
        threadId: "thread_1",
      },
    });
  });

  it("returns route-ready errors for malformed archive requests", async () => {
    const result = await chatRouteRequest.readArchiveThread({
      request: new Request("http://localhost/api/chat/threads/thread_1", {
        method: "PATCH",
        body: "not-json",
      }),
      threadId: "thread_1",
    });

    expect(result).toEqual({
      ok: false,
      result: {
        status: 400,
        body: { message: "Invalid request body." },
      },
    });
  });
});
