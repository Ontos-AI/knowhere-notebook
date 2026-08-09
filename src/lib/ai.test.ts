import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getChatModel, getChatModelLabel, isChatConfigured } from "./ai"

const original = {
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  CHAT_BASE_URL: process.env.CHAT_BASE_URL,
  CHAT_MODEL: process.env.CHAT_MODEL,
  CHAT_API_KEY: process.env.CHAT_API_KEY,
}

beforeEach(() => {
  delete process.env.AI_GATEWAY_API_KEY
  delete process.env.CHAT_BASE_URL
  delete process.env.CHAT_MODEL
  delete process.env.CHAT_API_KEY
})

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("isChatConfigured", () => {
  it("is false when no chat env is set", () => {
    expect(isChatConfigured()).toBe(false)
  })

  it("is true when AI_GATEWAY_API_KEY is set", () => {
    process.env.AI_GATEWAY_API_KEY = "vck_test"
    expect(isChatConfigured()).toBe(true)
  })

  it("is true when CHAT_BASE_URL is set", () => {
    process.env.CHAT_BASE_URL = "http://localhost:11434/v1"
    expect(isChatConfigured()).toBe(true)
  })
})

describe("getChatModel", () => {
  it("returns the gateway model string when CHAT_BASE_URL is unset", () => {
    expect(getChatModel()).toBe("google/gemini-3-flash")
  })

  it("builds an OpenAI-compatible model from CHAT_BASE_URL + CHAT_MODEL + CHAT_API_KEY", () => {
    process.env.CHAT_BASE_URL = "http://localhost:11434/v1"
    process.env.CHAT_MODEL = "qwen-plus"
    process.env.CHAT_API_KEY = "sk_test"

    const model = getChatModel()

    expect(typeof model).toBe("object")
    expect((model as { readonly modelId: string }).modelId).toBe("qwen-plus")
    expect(
      (model as { readonly specificationVersion: string }).specificationVersion,
    ).toBe("v3")
  })

  it("throws when CHAT_BASE_URL is set without CHAT_MODEL", () => {
    process.env.CHAT_BASE_URL = "http://localhost:11434/v1"
    delete process.env.CHAT_MODEL
    delete process.env.CHAT_API_KEY

    expect(() => getChatModel()).toThrow(/CHAT_MODEL is required/)
  })

  it("throws when CHAT_BASE_URL is set without CHAT_API_KEY", () => {
    process.env.CHAT_BASE_URL = "http://localhost:11434/v1"
    process.env.CHAT_MODEL = "qwen-plus"
    delete process.env.CHAT_API_KEY

    expect(() => getChatModel()).toThrow(/CHAT_API_KEY is required/)
  })
})

describe("getChatModelLabel", () => {
  it("returns the default model id when CHAT_MODEL is unset", () => {
    expect(getChatModelLabel()).toBe("google/gemini-3-flash")
  })
})
