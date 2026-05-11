import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  answerChat: vi.fn(),
}));

vi.mock("@/domains/chat/route-service", () => ({
  chatRouteService: {
    answerChat: mocks.answerChat,
  },
}));

import { POST } from "./route";

describe("POST /api/chat", () => {
  it("passes the JSON body to the chat route service", async () => {
    mocks.answerChat.mockResolvedValue({
      status: 200,
      body: {
        threadId: "thread_1",
        messages: [
          { id: "user_1", role: "user", content: "Summarize it" },
          { id: "assistant_1", role: "assistant", content: "Answer" },
        ],
      },
    });

    const response = await POST(
      new Request("http://localhost:3001/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "Summarize it" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      threadId: "thread_1",
      messages: [
        { id: "user_1", role: "user", content: "Summarize it" },
        { id: "assistant_1", role: "assistant", content: "Answer" },
      ],
    });
    expect(mocks.answerChat).toHaveBeenCalledWith({
      body: { message: "Summarize it" },
    });
  });

  it("passes null to the chat route service when JSON parsing fails", async () => {
    mocks.answerChat.mockResolvedValue({
      status: 400,
      body: { message: "Enter a question before sending." },
    });

    const response = await POST(
      new Request("http://localhost:3001/api/chat", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Enter a question before sending.",
    });
    expect(mocks.answerChat).toHaveBeenCalledWith({ body: null });
  });
});
