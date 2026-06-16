import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateChatDiagramSpec: vi.fn(),
  getAuthenticated: vi.fn(),
  getAuthenticatedWithClient: vi.fn(),
}))

vi.mock("@/domains/chat/diagram", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/chat/diagram")>()
  return {
    ...original,
    generateChatDiagramSpec: mocks.generateChatDiagramSpec,
  }
})

vi.mock("@/domains/workspace/request-context", () => ({
  notebookRequestContext: {
    getAuthenticated: mocks.getAuthenticated,
    getAuthenticatedWithClient: mocks.getAuthenticatedWithClient,
  },
}))

import { POST } from "./route"

describe("POST /api/chat/diagram", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("requires authentication without provisioning a Knowhere client", async () => {
    mocks.getAuthenticated.mockResolvedValue({
      user: { id: "user_1", name: null, email: null },
      workspace: { id: "workspace_1", namespace: "notebook-workspace_1" },
    })
    mocks.generateChatDiagramSpec.mockResolvedValue({
      type: "none",
      reason: "The answer did not contain enough concrete data for a chart.",
    })

    const response = await POST(
      new Request("http://localhost:3001/api/chat/diagram", {
        method: "POST",
        body: JSON.stringify({ answer: "Revenue was 42." }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      diagram: {
        type: "none",
        reason: "The answer did not contain enough concrete data for a chart.",
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.getAuthenticated).toHaveBeenCalledOnce()
    expect(mocks.getAuthenticatedWithClient).not.toHaveBeenCalled()
    expect(mocks.generateChatDiagramSpec).toHaveBeenCalledWith({
      answer: "Revenue was 42.",
    })
  })
})
