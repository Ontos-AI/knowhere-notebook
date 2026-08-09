import "server-only"

import { hash, verify } from "@node-rs/argon2"

/** Argon2id defaults tuned for interactive login (≈1s on modern hardware). */
const passwordHashOptions = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  return hash(password, passwordHashOptions)
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password, passwordHashOptions)
  } catch {
    return false
  }
}
