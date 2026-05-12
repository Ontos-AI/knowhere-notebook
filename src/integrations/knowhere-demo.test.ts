import { afterEach, describe, expect, it } from "vitest"

import { knowhereDemoApi } from "./knowhere-demo"

describe("knowhereDemoApi", () => {
  const originalBaseURL = process.env.KNOWHERE_BASE_URL

  afterEach(() => {
    restoreEnv("KNOWHERE_BASE_URL", originalBaseURL)
  })

  it("uses the configured Knowhere base URL for demo requests", () => {
    process.env.KNOWHERE_BASE_URL = "https://api-staging.knowhereto.ai"

    const url = knowhereDemoApi.resolveApiURL("/api/v1/demo/catalog")

    expect(url).toBe("https://api-staging.knowhereto.ai/api/v1/demo/catalog")
  })

  it("falls back to production API instead of localhost", () => {
    delete process.env.KNOWHERE_BASE_URL

    const url = knowhereDemoApi.resolveApiURL("/api/v1/demo/catalog")

    expect(url).toBe("https://api.knowhereto.ai/api/v1/demo/catalog")
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
