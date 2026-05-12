import { unstable_serialize } from "swr";
import type { Cache } from "swr";
import { describe, expect, it } from "vitest";

import { workspaceClientCache } from "./client-cache";
import type { ChatThreadView } from "@/domains/chat/types";

describe("workspaceClientCache", () => {
  it("builds chunk page keys until the selected Source has no more pages", () => {
    expect(workspaceClientCache.getSourceChunksKey(null, 0, null)).toBeNull();
    expect(workspaceClientCache.getSourceChunksKey("source_1", 1, null)).toEqual(
      ["source-chunks", "source_1", 2],
    );
    expect(
      workspaceClientCache.getSourceChunksKey("source_1", 1, {
        chunks: [],
        pagination: {
          page: 2,
          pageSize: 100,
          total: 200,
          totalPages: 2,
        },
      }),
    ).toBeNull();
  });

  it("reads loaded Chat Thread detail from an SWR cache", () => {
    const thread: ChatThreadView = {
      id: "thread_1",
      title: "Revenue",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    };
    const cache = new Map<string, unknown>([
      [
        unstable_serialize(workspaceClientCache.getChatThreadKey(thread.id)),
        {
          data: {
            requestedThreadId: thread.id,
            thread,
            messages: [],
          },
        },
      ],
    ]) as unknown as Cache<unknown>;

    expect(
      workspaceClientCache.getCachedChatThreadData(cache, thread.id),
    ).toEqual({
      requestedThreadId: thread.id,
      thread,
      messages: [],
    });
  });
});
