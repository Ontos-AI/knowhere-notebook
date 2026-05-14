import { describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock("./logger", () => ({
  logger: mocks.logger,
}))

import { withApiErrorResponse } from "./api-error-response"

describe("withApiErrorResponse", () => {
  it("logs Effect operation context for unhandled request failures", async () => {
    const response = await withApiErrorResponse(
      "sources:list",
      async () => {
        throw new Error("database connection refused")
      },
      "Could not list sources.",
    )

    await expect(response.json()).resolves.toEqual({
      message: "Could not list sources.",
    })
    expect(response.status).toBe(500)
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "api: unhandled request failure",
      expect.objectContaining({
        context: "sources:list",
        error: expect.stringContaining("API request sources:list failed"),
      }),
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "api: unhandled request failure",
      expect.objectContaining({
        error: expect.stringContaining("database connection refused"),
      }),
    )
  })

  it("returns successful route responses unchanged", async () => {
    const response = await withApiErrorResponse("sources:list", async () =>
      NextResponse.json({ ok: true }),
    )

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.status).toBe(200)
  })
})
