import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { decryptSecret, encryptSecret } from "./secret-crypto"

describe("secret-crypto", () => {
  const originalKey = process.env.KNOWHERE_KEY_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.KNOWHERE_KEY_ENCRYPTION_KEY = "test-encryption-key-1234567890"
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.KNOWHERE_KEY_ENCRYPTION_KEY
    else process.env.KNOWHERE_KEY_ENCRYPTION_KEY = originalKey
  })

  it("round-trips a secret through encrypt and decrypt", () => {
    const encrypted = encryptSecret("sk_super_secret_123")

    expect(encrypted.cipherText).not.toContain("super_secret")
    expect(decryptSecret(encrypted)).toBe("sk_super_secret_123")
  })

  it("produces a different cipher for the same plaintext (random nonce)", () => {
    const first = encryptSecret("sk_same")
    const second = encryptSecret("sk_same")

    expect(first.cipherText).not.toBe(second.cipherText)
    expect(first.nonce).not.toBe(second.nonce)
    expect(decryptSecret(first)).toBe("sk_same")
    expect(decryptSecret(second)).toBe("sk_same")
  })

  it("fails to decrypt tampered cipher text", () => {
    const encrypted = encryptSecret("sk_secret")
    const flippedChar =
      encrypted.cipherText[0] === "A" ? "B" : "A"
    const tampered = {
      ...encrypted,
      cipherText: `${flippedChar}${encrypted.cipherText.slice(1)}`,
    }

    expect(() => decryptSecret(tampered)).toThrow()
  })

  it("throws when no encryption key is configured", () => {
    delete process.env.KNOWHERE_KEY_ENCRYPTION_KEY

    expect(() => encryptSecret("sk_x")).toThrow(/KNOWHERE_KEY_ENCRYPTION_KEY/)
  })

  it("accepts a 32-byte base64 key directly", () => {
    const base64Key = Buffer.from(
      Array.from({ length: 32 }, (_, index) => index),
    ).toString("base64")
    process.env.KNOWHERE_KEY_ENCRYPTION_KEY = base64Key

    const encrypted = encryptSecret("sk_x")
    expect(decryptSecret(encrypted)).toBe("sk_x")
  })
})
