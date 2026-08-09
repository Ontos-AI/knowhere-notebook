import { describe, expect, it } from "vitest"

import { hashPassword, verifyPassword } from "./password"

describe("password", () => {
  it("round-trips a password through hash and verify", async () => {
    const passwordHash = await hashPassword("correct horse battery staple")

    expect(passwordHash).toContain("$argon2id$")
    expect(await verifyPassword("correct horse battery staple", passwordHash)).toBe(
      true,
    )
  })

  it("rejects a wrong password", async () => {
    const passwordHash = await hashPassword("right-password")

    expect(await verifyPassword("wrong-password", passwordHash)).toBe(false)
  })

  it("returns false for a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false)
  })
})
