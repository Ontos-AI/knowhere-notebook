import "dotenv/config"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env.local" })

import { Effect } from "effect"

import { databaseRuntime } from "@/domains/workspace/database-runtime"
import { usersRepository } from "@/infrastructure/auth/users-repository"
import { accountLinksRepository } from "@/infrastructure/auth/account-links-repository"
import { hashPassword } from "@/lib/password"

/**
 * Admin-provisioned user creation (no public signup in Phase 2).
 *
 * Usage:
 *   pnpm exec tsx scripts/create-user.ts <email> <password> [--name "Full Name"]
 *
 * Requires DATABASE_URL in the environment (dotenv loads .env.local).
 */
async function main(): Promise<void> {
  const [emailArg, passwordArg] = process.argv.slice(2)
  const name = extractName(process.argv.slice(2))

  if (!emailArg || !passwordArg) {
    console.error(
      "Usage: pnpm exec tsx scripts/create-user.ts <email> <password> [--name \"Full Name\"]",
    )
    process.exit(1)
  }

  const email = emailArg.trim().toLowerCase()
  if (!email.includes("@")) {
    console.error(`Invalid email: ${email}`)
    process.exit(1)
  }
  if (passwordArg.length < 8) {
    console.error("Password must be at least 8 characters.")
    process.exit(1)
  }

  const passwordHash = await hashPassword(passwordArg)
  const user = await databaseRuntime.runPromise(
    Effect.gen(function* () {
      const existing = yield* usersRepository.findByEmailEffect(email)
      if (existing) {
        throw new Error(`User with email ${email} already exists.`)
      }

      const created = yield* usersRepository.insertEffect({
        email,
        name: name ?? null,
      })
      yield* accountLinksRepository.insertEffect({
        userId: created.id,
        provider: "password",
        providerUserId: null,
        passwordHash,
      })
      return created
    }),
  )

  console.log(`Created user ${user.email} (${user.id}).`)
  process.exit(0)
}

function extractName(args: readonly string[]): string | null {
  const index = args.indexOf("--name")
  if (index === -1) return null
  const value = args[index + 1]
  return value && value.trim().length > 0 ? value.trim() : null
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
