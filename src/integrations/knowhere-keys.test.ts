import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDefaultKnowhereKeyLabel,
  getKnowhereKeyByLabel,
  listKnowhereKeys,
  listMaskedKnowhereKeys,
  maskApiKey,
} from "./knowhere-keys"

describe("knowhere-keys", () => {
  let tempDir: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "knowhere-keys-test-"))
    delete process.env.KNOWHERE_KEYS_FILE
    delete process.env.KNOWHERE_API_KEY
    vi.resetModules()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    process.env.KNOWHERE_KEYS_FILE = originalEnv.KNOWHERE_KEYS_FILE
    process.env.KNOWHERE_API_KEY = originalEnv.KNOWHERE_API_KEY
  })

  it("falls back to KNOWHERE_API_KEY env as a single 'default' key", async () => {
    process.env.KNOWHERE_API_KEY = "sk_env_key_123"

    expect(await listKnowhereKeys()).toEqual([
      { label: "default", apiKey: "sk_env_key_123" },
    ])
    expect(await getDefaultKnowhereKeyLabel()).toBe("default")
    expect(await getKnowhereKeyByLabel("default")).toEqual({
      label: "default",
      apiKey: "sk_env_key_123",
    })
  })

  it("returns no keys when neither env nor file is configured", async () => {
    expect(await listKnowhereKeys()).toEqual([])
    expect(await getDefaultKnowhereKeyLabel()).toBe("default")
    expect(await getKnowhereKeyByLabel("default")).toBeNull()
  })

  it("reads labeled keys from the keys file", async () => {
    const filePath = join(tempDir, "keys.json")
    await writeFile(
      filePath,
      JSON.stringify([
        { label: "domainA", apiKey: "sk_a_1" },
        { label: "domainB", apiKey: "sk_b_2" },
      ]),
    )
    process.env.KNOWHERE_KEYS_FILE = filePath

    expect(await listKnowhereKeys()).toEqual([
      { label: "domainA", apiKey: "sk_a_1" },
      { label: "domainB", apiKey: "sk_b_2" },
    ])
    expect(await getDefaultKnowhereKeyLabel()).toBe("domainA")
    expect(await getKnowhereKeyByLabel("domainB")).toEqual({
      label: "domainB",
      apiKey: "sk_b_2",
    })
    expect(await getKnowhereKeyByLabel("missing")).toBeNull()
  })

  it("re-reads the file when its mtime changes (no-restart edits)", async () => {
    const filePath = join(tempDir, "keys.json")
    await writeFile(filePath, JSON.stringify([{ label: "a", apiKey: "sk_1" }]))
    process.env.KNOWHERE_KEYS_FILE = filePath

    expect(await listKnowhereKeys()).toEqual([{ label: "a", apiKey: "sk_1" }])

    // Give the file a different mtime so the cache invalidates.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await writeFile(
      filePath,
      JSON.stringify([
        { label: "a", apiKey: "sk_1" },
        { label: "b", apiKey: "sk_2" },
      ]),
    )

    expect(await listKnowhereKeys()).toEqual([
      { label: "a", apiKey: "sk_1" },
      { label: "b", apiKey: "sk_2" },
    ])
  })

  it("ignores malformed entries and a missing file", async () => {
    const filePath = join(tempDir, "keys.json")
    await writeFile(
      filePath,
      JSON.stringify([
        { label: "ok", apiKey: "sk_ok" },
        { label: "", apiKey: "sk_no_label" },
        { label: "no-key" },
        "not-an-object",
      ]),
    )
    process.env.KNOWHERE_KEYS_FILE = filePath

    expect(await listKnowhereKeys()).toEqual([{ label: "ok", apiKey: "sk_ok" }])
  })

  it("masks keys for display", () => {
    expect(maskApiKey("sk_8aBdXbOvF_Qibah2-_BDNo1-VCd50A16CwfiremGVB8")).toBe(
      "sk_8aB••••GVB8",
    )
    expect(listMaskedKnowhereKeys).toBeTypeOf("function")
  })
})
