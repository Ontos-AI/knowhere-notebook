import { describe, expect, it } from "vitest"

import { routeResult } from "./route-result"

describe("routeResult", () => {
  it("creates success and error route results", () => {
    expect(routeResult.ok({ value: "ready" })).toEqual({
      status: 200,
      body: { value: "ready" },
    })
    expect(routeResult.ok({ id: "source-1" }, 201)).toEqual({
      status: 201,
      body: { id: "source-1" },
    })
    expect(routeResult.error(404, "Not found.")).toEqual({
      status: 404,
      body: { message: "Not found." },
    })
  })

  it("reads JSON request bodies without throwing on invalid input", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ archived: true }),
    })
    const invalidRequest = new Request("http://localhost/api", {
      method: "POST",
      body: "{",
    })

    await expect(routeResult.readJson(request)).resolves.toEqual({
      ok: true,
      value: { archived: true },
    })
    await expect(routeResult.readJson(invalidRequest)).resolves.toEqual({
      ok: false,
    })
  })
})
