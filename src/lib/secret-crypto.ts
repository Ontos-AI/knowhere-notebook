import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

/**
 * AES-256-GCM encryption for secrets at rest (Knowhere API keys).
 *
 * The encryption key comes from `KNOWHERE_KEY_ENCRYPTION_KEY` env: if it is
 * a 32-byte base64 string it is used directly, otherwise it is SHA-256-hashed
 * to 32 bytes (so any string works). GCM auth tag is appended to the cipher
 * text and verified on decrypt.
 */

export type EncryptedSecret = {
  readonly cipherText: string
  readonly nonce: string
}

function getEncryptionKey(): Buffer {
  const configured = process.env.KNOWHERE_KEY_ENCRYPTION_KEY?.trim()
  if (!configured || configured.length === 0) {
    throw new Error(
      "KNOWHERE_KEY_ENCRYPTION_KEY is required to store Knowhere API keys. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
  }

  // Accept either a raw 32-byte base64 key or any passphrase (hashed to 32B).
  try {
    const decoded = Buffer.from(configured, "base64")
    if (decoded.length === 32) return decoded
  } catch {
    // fall through to hashing
  }
  return createHash("sha256").update(configured).digest()
}

export function encryptSecret(plainText: string): EncryptedSecret {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce)
  const cipherText = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return {
    cipherText: cipherText.toString("base64"),
    nonce: nonce.toString("base64"),
  }
}

export function decryptSecret(encrypted: EncryptedSecret): string {
  const nonce = Buffer.from(encrypted.nonce, "base64")
  const payload = Buffer.from(encrypted.cipherText, "base64")

  const authTag = payload.subarray(payload.length - 16)
  const data = payload.subarray(0, payload.length - 16)

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  )
}
